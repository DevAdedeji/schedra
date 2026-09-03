import { and, eq, inArray, sql } from 'drizzle-orm'
import { cancelBookingSchema } from '#shared/validation'
import { bookingPayments, bookings } from '../../../database/schema'
import { useDatabase } from '../../../database/index'
import { assignedHostsForBooking, findBookingByUid } from '../../../repositories/booking'
import { queueCancellationEmails } from '../../../services/booking-emails'
import { getAuthSession } from '../../../services/session'
import { enforceRateLimit } from '../../../services/rate-limit'
import { enqueueCalendarSync } from '../../../services/calendar-sync'
import { cancelBookingReminders } from '../../../services/email-outbox'
import { cancelPendingAutomationRuns, publishBookingEvent } from '../../../services/workflows'
import { requestPaidBookingRefund } from '../../../services/paid-booking'
import { recordSecurityAudit } from '../../../services/security-audit'
import { logEvent } from '../../../observability/logger'

export default defineEventHandler(async (event) => {
  const uid = getRouterParam(event, 'uid')
  await enforceRateLimit(event, {
    namespace: 'cancel-booking',
    identity: uid,
    limit: 8,
    windowSeconds: 600
  })
  const parsed = await readValidatedBody(event, cancelBookingSchema.safeParse)

  if (!uid || !parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid cancellation' })
  }

  const booking = await findBookingByUid(uid)

  if (!booking) {
    throw createError({ statusCode: 404, statusMessage: 'No such booking' })
  }

  const session = await getAuthSession(event)
  const hosts = await assignedHostsForBooking(booking.id)
  const actor = hosts.some(host => host.userId === session?.user.id) ? 'host' : 'guest'
  const refundReason = parsed.data.reason || `Booking cancelled by ${actor}`

  if (booking.status === 'cancelled') {
    const refund = await safelyRequestRefund(booking.id, refundReason)
    return refundResponse(true, refund)
  }

  if (booking.endsAt.getTime() < Date.now()) {
    throw createError({ statusCode: 409, statusMessage: 'That meeting has already happened.' })
  }

  const cancelled = await useDatabase().transaction(async (tx) => {
    const [updated] = await tx
      .update(bookings)
      .set({
        status: 'cancelled',
        cancellationReason: parsed.data.reason || null,
        updatedAt: sql`now()`
      })
      .where(and(
        eq(bookings.id, booking.id),
        inArray(bookings.status, ['awaiting_payment', 'pending', 'confirmed'])
      ))
      .returning({ id: bookings.id })

    if (!updated) return false

    if (booking.status === 'awaiting_payment') {
      await tx.update(bookingPayments).set({
        status: 'expired',
        lastError: 'The guest cancelled before checkout completed.',
        updatedAt: sql`now()`
      }).where(and(
        eq(bookingPayments.bookingId, booking.id),
        eq(bookingPayments.status, 'pending')
      ))
    }

    if (booking.status === 'confirmed') await enqueueCalendarSync(booking.id, 'delete', tx)
    await cancelBookingReminders(booking.uid, tx)
    await cancelPendingAutomationRuns(booking.id, tx)
    if (booking.status !== 'awaiting_payment') await publishBookingEvent({
      type: 'booking_cancelled',
      ...(booking.organizationId ? { organizationId: booking.organizationId } : { userId: booking.hostId }),
      bookingId: booking.id,
      eventTypeId: booking.eventTypeId,
      payload: { actor }
    }, tx)
    if (booking.status !== 'awaiting_payment') {
      await queueCancellationEmails(booking, parsed.data.reason, actor, tx, hosts)
    }
    return true
  })

  if (!cancelled) {
    const refund = await safelyRequestRefund(booking.id, refundReason)
    return refundResponse(true, refund)
  }

  // The calendar reservation is cancelled before crossing the provider
  // boundary. A timeout can then leave a refund pending for reconciliation,
  // but it can never refund a booking that remained active locally.
  const refund = await safelyRequestRefund(booking.id, refundReason)

  await recordSecurityAudit({
    action: 'booking.cancelled',
    actorUserId: session?.user.id,
    actorEmail: session?.user.email,
    organizationId: booking.organizationId,
    targetType: 'booking',
    targetId: booking.id,
    metadata: { actor, paidRefundRequired: refund.required, refundState: refund.providerState }
  }, event)

  return refundResponse(false, refund)
})

async function safelyRequestRefund(bookingId: string, reason: string) {
  try {
    return await requestPaidBookingRefund(bookingId, reason)
  } catch (error) {
    logEvent('error', 'paid_booking_refund_request_failed', { bookingId, error })
    return { required: true as const, providerState: 'failed' as const }
  }
}

function refundResponse(
  alreadyCancelled: boolean,
  refund: Awaited<ReturnType<typeof safelyRequestRefund>>
) {
  return {
    ok: true,
    alreadyCancelled,
    refundPending: refund.required && ['pending', 'unknown'].includes(refund.providerState),
    refundFailed: refund.providerState === 'failed',
    refunded: refund.providerState === 'paid'
  }
}
