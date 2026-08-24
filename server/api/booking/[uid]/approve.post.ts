import { and, eq, gt, sql } from 'drizzle-orm'
import { bookings } from '../../../database/schema'
import { bookingNoticeFromManaged, queueBookingEmails } from '../../../utils/booking-emails'
import { findBookingByUid } from '../../../utils/booking-manage'
import { enqueueCalendarSync } from '../../../utils/calendar-sync'
import { requireAuthSession } from '../../../utils/session'
import { useDatabase } from '../../../utils/database'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const uid = getRouterParam(event, 'uid')
  if (!uid) throw createError({ statusCode: 400, statusMessage: 'Missing booking.' })

  const booking = await findBookingByUid(uid)
  if (!booking || booking.hostId !== session.user.id) {
    throw createError({ statusCode: 404, statusMessage: 'No such booking request.' })
  }
  if (booking.status !== 'pending') {
    throw createError({ statusCode: 409, statusMessage: 'This booking request has already been handled.' })
  }

  await useDatabase().transaction(async (tx) => {
    const [approved] = await tx.update(bookings).set({
      status: 'confirmed',
      cancellationReason: null,
      updatedAt: sql`now()`
    }).where(and(
      eq(bookings.id, booking.id),
      eq(bookings.status, 'pending'),
      gt(bookings.endsAt, new Date())
    )).returning({ id: bookings.id })

    if (!approved) throw createError({ statusCode: 409, statusMessage: 'This request expired or was already handled.' })
    await enqueueCalendarSync(booking.id, 'upsert', tx)
    await queueBookingEmails(bookingNoticeFromManaged(booking), tx)
  })

  return { ok: true }
})
