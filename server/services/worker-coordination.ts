import { and, eq, lt, sql } from 'drizzle-orm'
import { useDatabase } from '../database'
import { workerInstances, workerLeases } from '../database/schema'
import { logEvent } from '../observability/logger'

const DEFAULT_LEASE_MS = 60_000

function leaseExpiry(ttlMs: number) {
  return sql`now() + (${ttlMs} * interval '1 millisecond')`
}

export async function acquireWorkerLease(name: string, ownerId: string, ttlMs = DEFAULT_LEASE_MS) {
  const [lease] = await useDatabase().insert(workerLeases).values({
    name,
    ownerId,
    expiresAt: leaseExpiry(ttlMs)
  }).onConflictDoUpdate({
    target: workerLeases.name,
    set: {
      ownerId,
      expiresAt: leaseExpiry(ttlMs),
      heartbeatAt: sql`now()`,
      updatedAt: sql`now()`
    },
    // The current owner may extend its lease. Another process may only take
    // over after the database clock says the previous lease has expired.
    setWhere: sql`${workerLeases.expiresAt} <= now() or ${workerLeases.ownerId} = ${ownerId}`
  }).returning({ name: workerLeases.name })
  return Boolean(lease)
}

export async function heartbeatWorkerLease(name: string, ownerId: string, ttlMs = DEFAULT_LEASE_MS) {
  const rows = await useDatabase().update(workerLeases).set({
    expiresAt: leaseExpiry(ttlMs),
    heartbeatAt: sql`now()`,
    updatedAt: sql`now()`
  }).where(and(
    eq(workerLeases.name, name),
    eq(workerLeases.ownerId, ownerId)
  )).returning({ name: workerLeases.name })
  return Boolean(rows.length)
}

export async function releaseWorkerLease(name: string, ownerId: string) {
  await useDatabase().delete(workerLeases).where(and(
    eq(workerLeases.name, name),
    eq(workerLeases.ownerId, ownerId)
  ))
}

export async function releaseWorkerLeases(ownerId: string) {
  await useDatabase().delete(workerLeases).where(eq(workerLeases.ownerId, ownerId))
}

export async function withWorkerLease<T>(input: {
  name: string
  ownerId: string
  task: () => Promise<T>
  ttlMs?: number
}) {
  const ttlMs = Math.max(input.ttlMs ?? DEFAULT_LEASE_MS, 3_000)
  if (!await acquireWorkerLease(input.name, input.ownerId, ttlMs)) {
    return { acquired: false as const, result: undefined }
  }

  let heartbeating = false
  const timer = setInterval(() => {
    if (heartbeating) return
    heartbeating = true
    void heartbeatWorkerLease(input.name, input.ownerId, ttlMs)
      .then((held) => {
        if (!held) logEvent('error', 'worker_lease_lost', { task: input.name, workerId: input.ownerId })
      })
      .catch(error => logEvent('error', 'worker_lease_heartbeat_failed', {
        task: input.name,
        workerId: input.ownerId,
        error
      }))
      .finally(() => { heartbeating = false })
  }, Math.max(1_000, Math.floor(ttlMs / 3)))
  timer.unref()

  try {
    return { acquired: true as const, result: await input.task() }
  } finally {
    clearInterval(timer)
    await releaseWorkerLease(input.name, input.ownerId)
  }
}

export async function registerWorkerInstance(id: string, role: 'worker' | 'all') {
  await useDatabase().insert(workerInstances).values({ id, role }).onConflictDoUpdate({
    target: workerInstances.id,
    set: {
      role,
      startedAt: sql`now()`,
      lastSeenAt: sql`now()`,
      stoppedAt: null,
      updatedAt: sql`now()`
    }
  })
}

export async function heartbeatWorkerInstance(id: string) {
  const rows = await useDatabase().update(workerInstances).set({
    lastSeenAt: sql`now()`,
    stoppedAt: null,
    updatedAt: sql`now()`
  }).where(eq(workerInstances.id, id)).returning({ id: workerInstances.id })
  return Boolean(rows.length)
}

export async function stopWorkerInstance(id: string, releaseLeases = true) {
  await useDatabase().update(workerInstances).set({
    stoppedAt: sql`now()`,
    lastSeenAt: sql`now()`,
    updatedAt: sql`now()`
  }).where(eq(workerInstances.id, id))
  if (releaseLeases) await releaseWorkerLeases(id)
}

export async function pruneWorkerInstances() {
  await useDatabase().delete(workerInstances).where(and(
    lt(workerInstances.lastSeenAt, sql`now() - interval '7 days'`),
    sql`${workerInstances.stoppedAt} is not null`
  ))
}
