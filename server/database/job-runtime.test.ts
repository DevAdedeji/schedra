import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { configureAppTestEnvironment, getTestDatabaseUrl } from '../../test/helpers/database'

const url = getTestDatabaseUrl()
const ownerA = '00000000-0000-4000-8000-000000000001'
const ownerB = '00000000-0000-4000-8000-000000000002'

describe.skipIf(!url)('production job runtime', () => {
  const sql = postgres(url!, { max: 3, onnotice: () => {} })

  beforeEach(async () => {
    configureAppTestEnvironment(url!)
    const { resetEnv } = await import('../config/env')
    resetEnv()
    await sql`truncate table worker_leases, worker_instances restart identity cascade`
  })

  afterAll(async () => {
    await sql`truncate table worker_leases, worker_instances restart identity cascade`
    await sql.end()
  })

  it('lets only one worker own a scheduled task at a time', async () => {
    const { withWorkerLease } = await import('../services/worker-coordination')
    let enter!: () => void
    let release!: () => void
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const first = withWorkerLease({
      name: 'runtime:test-exclusive',
      ownerId: ownerA,
      task: async () => {
        enter()
        await gate
        return 'first'
      }
    })
    await entered

    let duplicateRan = false
    const duplicate = await withWorkerLease({
      name: 'runtime:test-exclusive',
      ownerId: ownerB,
      task: async () => {
        duplicateRan = true
      }
    })
    expect(duplicate.acquired).toBe(false)
    expect(duplicateRan).toBe(false)

    release()
    await expect(first).resolves.toMatchObject({ acquired: true, result: 'first' })
  })

  it('recovers a lease left behind by a crashed worker after it expires', async () => {
    await sql`
      insert into worker_leases (name, owner_id, expires_at)
      values ('runtime:abandoned', ${ownerA}, now() - interval '1 second')
    `
    const { acquireWorkerLease } = await import('../services/worker-coordination')
    await expect(acquireWorkerLease('runtime:abandoned', ownerB)).resolves.toBe(true)

    const [lease] = await sql<{ owner_id: string }[]>`
      select owner_id from worker_leases where name = 'runtime:abandoned'
    `
    expect(lease?.owner_id).toBe(ownerB)
  })

  it('registers, runs and gracefully stops a dedicated worker', async () => {
    const { createJobRuntime } = await import('../services/job-runtime')
    let ran!: () => void
    const executed = new Promise<void>((resolve) => {
      ran = resolve
    })
    const runtime = createJobRuntime({
      role: 'worker',
      workerId: ownerA,
      heartbeatMs: 60_000,
      tasks: [{
        name: 'test-task',
        intervalMs: 60_000,
        run: async () => {
          ran()
          return 1
        }
      }]
    })

    await runtime.start()
    await executed
    await runtime.stop()

    const [worker] = await sql<{ role: string, stopped_at: Date | null }[]>`
      select role, stopped_at from worker_instances where id = ${ownerA}
    `
    expect(worker?.role).toBe('worker')
    expect(worker?.stopped_at).toBeInstanceOf(Date)

    const [leases] = await sql<{ count: number }[]>`
      select count(*)::int as count from worker_leases where owner_id = ${ownerA}
    `
    expect(leases?.count).toBe(0)
  })

  it('keeps a timed-out task leased until that task actually finishes', async () => {
    const { createJobRuntime } = await import('../services/job-runtime')
    let entered!: () => void
    let release!: () => void
    const running = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const runtime = createJobRuntime({
      role: 'worker',
      workerId: ownerA,
      heartbeatMs: 60_000,
      shutdownTimeoutMs: 5,
      tasks: [{
        name: 'slow-task',
        intervalMs: 60_000,
        run: async () => {
          entered()
          await gate
        }
      }]
    })

    await runtime.start()
    await running
    await runtime.stop()

    const [duringShutdown] = await sql<{ count: number }[]>`
      select count(*)::int as count from worker_leases where owner_id = ${ownerA}
    `
    expect(duringShutdown?.count).toBe(1)

    release()
    await expect.poll(async () => {
      const [afterFinish] = await sql<{ count: number }[]>`
        select count(*)::int as count from worker_leases where owner_id = ${ownerA}
      `
      return afterFinish?.count
    }).toBe(0)
  })

  it('reports live and stopped workers through private diagnostics', async () => {
    const { registerWorkerInstance, stopWorkerInstance } = await import('../services/worker-coordination')
    const { operationsDiagnostics } = await import('../services/operations')
    await registerWorkerInstance(ownerA, 'all')
    await expect(operationsDiagnostics()).resolves.toMatchObject({
      worker: { ok: true, active: 1 }
    })

    await stopWorkerInstance(ownerA)
    await expect(operationsDiagnostics()).resolves.toMatchObject({
      worker: { ok: false, active: 0 }
    })
  })
})
