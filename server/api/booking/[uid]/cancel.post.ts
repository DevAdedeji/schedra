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

  if (booking.status === 'cancelled') {
    return { ok: true, alreadyCancelled: true }
  }

  if (booking.endsAt.getTime() < Date.now()) {
    throw createError({ statusCode: 409, statusMessage: 'That meeting has already happened.' })
  }

  const session = await getAuthSession(event)
  const hosts = await assignedHostsForBooking(booking.id)
  const actor = hosts.some(host => host.userId === session?.user.id) ? 'host' : 'guest'
  const refund = await requestPaidBookingRefund(
    booking.id,
    parsed.data.reason || `Booking cancelled by ${actor}`
  )
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
    return { ok: true, alreadyCancelled: true }
  }

  await recordSecurityAudit({
    action: 'booking.cancelled',
    actorUserId: session?.user.id,
    actorEmail: session?.user.email,
    organizationId: booking.organizationId,
    targetType: 'booking',
    targetId: booking.id,
    metadata: { actor, paidRefundRequired: refund.required }
  }, event)

  return { ok: true, alreadyCancelled: false, refundPending: refund.required }
})
