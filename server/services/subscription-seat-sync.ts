import { and, asc, count, eq, inArray, lt, lte, sql } from 'drizzle-orm'
import type { Database } from '../database/client'
import {
  members,
  organizationSubscriptions,
  subscriptionSeatSyncJobs
} from '../database/schema'
import { useDatabase } from '../database'
import {
  ensureTeamProduct,
  getSubscription,
  updateSubscriptionMetadata,
  updateSubscriptionPlan
} from '../integrations/bachs'
import { billableSeats, type BillingInterval } from '#shared/billing'
import { recordAudit } from './organization'
import { logEvent } from '../observability/logger'
import { addToInstant } from '../utils/date-time'

type SeatSyncExecutor = Pick<Database, 'insert'>

/**
 * One row per organization coalesces rapid joins/removals. If a new membership
 * change arrives while a worker is processing, the upsert moves the row back to
 * pending; the older worker's conditional completion cannot erase that signal.
 */
export async function enqueueSubscriptionSeatSync(
  organizationId: string,
  executor: SeatSyncExecutor = useDatabase()
) {
  await executor.insert(subscriptionSeatSyncJobs).values({ organizationId })
    .onConflictDoUpdate({
      target: subscriptionSeatSyncJobs.organizationId,
      set: {
        status: 'pending',
        attempts: 0,
        availableAt: sql`now()`,
        lockedAt: null,
        completedAt: null,
        lastError: null,
        updatedAt: sql`now()`
      }
    })
}

function metadataSeatCount(value: string | undefined) {
  const seats = Number.parseInt(value ?? '', 10)
  return Number.isInteger(seats) && seats > 0 ? seats : null
}

/**
 * Bachs quantity cannot be changed today. A seat-count product has the complete
 * recurring amount, so changing products with invoice_now gives an immediate
 * prorated charge (or a future-invoice credit on removal).
 */
export async function syncSubscriptionSeats(organizationId: string) {
  const db = useDatabase()
  const [[subscription], [seatRow]] = await Promise.all([
    db.select().from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, organizationId))
      .limit(1),
    db.select({ value: count() }).from(members)
      .where(eq(members.organizationId, organizationId))
  ])

  if (!subscription) return { action: 'missing-subscription' as const }

  const desiredSeats = billableSeats(seatRow?.value ?? 0)
  if (subscription.status === 'trialing') {
    return { action: 'trial' as const, desiredSeats }
  }

  // Bank transfers cannot be charged without the owner acting. Those teams
  // keep their occupied-seat total for the next explicit invoice; the UI makes
  // that distinction clear rather than pretending an automatic charge occurred.
  if (subscription.collectionMethod !== 'charge_automatically') {
    return { action: 'manual-invoice' as const, desiredSeats }
  }

  if (subscription.status === 'canceled' || subscription.status === 'paused') {
    return { action: 'inactive' as const, desiredSeats }
  }

  if (!subscription.bachsSubscriptionId) {
    throw new Error('The Bachs subscription is still awaiting confirmation.')
  }

  let remote = await getSubscription(subscription.bachsSubscriptionId)
  if (remote.status === 'canceled' || remote.status === 'paused') {
    return { action: 'inactive' as const, desiredSeats }
  }

  // Older checkouts represented seats with line-item quantity. They need no
  // change when that quantity already matches occupied seats. Applying a
  // full-price seat-count product to any other legacy quantity could multiply
  // the charge, so that transition fails closed instead.
  const legacyQuantity = remote.quantity ?? 1
  if (legacyQuantity !== 1 && legacyQuantity === desiredSeats) {
    await db.update(organizationSubscriptions).set({
      seatsAtLastInvoice: desiredSeats,
      updatedAt: sql`now()`
    }).where(eq(organizationSubscriptions.organizationId, organizationId))
    return { action: 'current' as const, desiredSeats, remote }
  }
  if (legacyQuantity !== 1) {
    throw new Error('This legacy subscription must be replaced before automatic seat billing can continue.')
  }

  const productId = await ensureTeamProduct(subscription.interval as BillingInterval, desiredSeats)
  let planChanged = false
  if (remote.product?.id !== productId) {
    remote = await updateSubscriptionPlan(
      subscription.bachsSubscriptionId,
      productId,
      'invoice_now'
    )
    planChanged = true
  }

  const remoteSeats = metadataSeatCount(remote.metadata?.seats)
    ?? metadataSeatCount(remote.product?.metadata?.schedra_seats)
  if (remoteSeats !== desiredSeats) {
    await updateSubscriptionMetadata(subscription.bachsSubscriptionId, {
      seats: String(desiredSeats)
    })
  }

  await db.update(organizationSubscriptions).set({
    seatsAtLastInvoice: desiredSeats,
    updatedAt: sql`now()`
  }).where(eq(organizationSubscriptions.organizationId, organizationId))

  if (planChanged) {
    await recordAudit({
      organizationId,
      action: 'billing.seats_updated',
      targetType: 'subscription',
      targetId: subscription.bachsSubscriptionId,
      metadata: {
        previousSeats: subscription.seatsAtLastInvoice,
        seats: desiredSeats,
        proration: 'invoice_now'
      }
    })
  }

  return { action: planChanged ? 'updated' as const : 'current' as const, desiredSeats, remote }
}

export async function processSubscriptionSeatSyncJobs(batchSize = 10) {
  const db = useDatabase()

  const jobs = await db.transaction(async (tx) => {
    await tx.update(subscriptionSeatSyncJobs).set({
      status: 'pending',
      lockedAt: null,
      availableAt: sql`now()`,
      updatedAt: sql`now()`
    }).where(and(
      eq(subscriptionSeatSyncJobs.status, 'processing'),
      lt(subscriptionSeatSyncJobs.lockedAt, sql`now() - interval '10 minutes'`)
    ))

    const pending = await tx.select().from(subscriptionSeatSyncJobs)
      .where(and(
        eq(subscriptionSeatSyncJobs.status, 'pending'),
        lte(subscriptionSeatSyncJobs.availableAt, sql`now()`)
      ))
      .orderBy(asc(subscriptionSeatSyncJobs.availableAt), asc(subscriptionSeatSyncJobs.createdAt))
      .limit(batchSize)
      .for('update', { skipLocked: true })

    if (!pending.length) return []

    return tx.update(subscriptionSeatSyncJobs).set({
      status: 'processing',
      lockedAt: sql`now()`,
      attempts: sql`${subscriptionSeatSyncJobs.attempts} + 1`,
      updatedAt: sql`now()`
    }).where(inArray(subscriptionSeatSyncJobs.id, pending.map(job => job.id))).returning()
  })

  for (const job of jobs) {
    try {
      await syncSubscriptionSeats(job.organizationId)
      await db.update(subscriptionSeatSyncJobs).set({
        status: 'completed',
        completedAt: sql`now()`,
        lockedAt: null,
        lastError: null,
        updatedAt: sql`now()`
      }).where(and(
        eq(subscriptionSeatSyncJobs.id, job.id),
        eq(subscriptionSeatSyncJobs.status, 'processing')
      ))
    } catch (error) {
      const failed = job.attempts >= 8
      const delaySeconds = Math.min(3600, 15 * 2 ** Math.max(0, job.attempts - 1))
      await db.update(subscriptionSeatSyncJobs).set({
        status: failed ? 'failed' : 'pending',
        availableAt: addToInstant(Date.now(), { seconds: delaySeconds }),
        lockedAt: null,
        lastError: String(error instanceof Error ? error.message : error).slice(0, 1000),
        updatedAt: sql`now()`
      }).where(and(
        eq(subscriptionSeatSyncJobs.id, job.id),
        eq(subscriptionSeatSyncJobs.status, 'processing')
      ))

      logEvent('error', 'subscription_seat_sync_failed', {
        organizationId: job.organizationId,
        attempt: job.attempts,
        terminal: failed,
        error
      })
    }
  }

  return jobs.length
}
