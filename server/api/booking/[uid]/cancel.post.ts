import { and, eq, inArray, sql } from 'drizzle-orm'
import { cancelBookingSchema } from '#shared/validation'
import { bookings } from '../../../database/schema'
import { useDatabase } from '../../../database/index'
import { assignedHostsForBooking, findBookingByUid } from '../../../repositories/booking'
import { queueCancellationEmails } from '../../../services/booking-emails'
import { getAuthSession } from '../../../services/session'
import { enforceRateLimit } from '../../../services/rate-limit'
import { enqueueCalendarSync } from '../../../services/calendar-sync'
import { cancelBookingReminders } from '../../../services/email-outbox'
import { cancelPendingAutomationRuns, publishBookingEvent } from '../../../services/workflows'

export default defineEventHandler(async (event) => {
  const uid = getRouterParam(event, 'uid')
  await enforceRateLimit(event, {
    namespace: 'cancel-booking',
    identity: uid,
    limit: 20,
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
        inArray(bookings.status, ['pending', 'confirmed'])
      ))
      .returning({ id: bookings.id })

    if (!updated) return false

    await enqueueCalendarSync(booking.id, 'delete', tx)
    await cancelBookingReminders(booking.uid, tx)
    await cancelPendingAutomationRuns(booking.id, tx)
    await publishBookingEvent({
      type: 'booking_cancelled',
      ...(booking.organizationId ? { organizationId: booking.organizationId } : { userId: booking.hostId }),
      bookingId: booking.id,
      eventTypeId: booking.eventTypeId,
      payload: { actor }
    }, tx)
    await queueCancellationEmails(booking, parsed.data.reason, actor, tx, hosts)
    return true
  })

  if (!cancelled) {
    return { ok: true, alreadyCancelled: true }
  }

  return { ok: true, alreadyCancelled: false }
})
