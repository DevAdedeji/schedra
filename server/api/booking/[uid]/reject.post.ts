import { and, eq, sql } from 'drizzle-orm'
import { rejectBookingSchema } from '#shared/validation'
import { bookings } from '../../../database/schema'
import { queueBookingRejectedEmails } from '../../../services/booking-emails'
import { assignedHostsForBooking, findBookingByUid } from '../../../repositories/booking'
import { requireAuthSession } from '../../../services/session'
import { useDatabase } from '../../../database/index'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const uid = getRouterParam(event, 'uid')
  const parsed = await readValidatedBody(event, rejectBookingSchema.safeParse)
  if (!uid || !parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.success ? 'Missing booking.' : 'That response is not valid.' })
  }

  const booking = await findBookingByUid(uid)
  if (!booking) {
    throw createError({ statusCode: 404, statusMessage: 'No such booking request.' })
  }
  const hosts = await assignedHostsForBooking(booking.id)
  if (!hosts.some(host => host.userId === session.user.id)) {
    throw createError({ statusCode: 404, statusMessage: 'No such booking request.' })
  }
  if (booking.status !== 'pending') {
    throw createError({ statusCode: 409, statusMessage: 'This booking request has already been handled.' })
  }

  await useDatabase().transaction(async (tx) => {
    const [rejected] = await tx.update(bookings).set({
      status: 'rejected',
      cancellationReason: parsed.data.reason || 'Declined by the host',
      updatedAt: sql`now()`
    }).where(and(eq(bookings.id, booking.id), eq(bookings.status, 'pending')))
      .returning({ id: bookings.id })
    if (!rejected) throw createError({ statusCode: 409, statusMessage: 'This request was already handled.' })
    await queueBookingRejectedEmails(booking, parsed.data.reason, tx, hosts)
  })

  return { ok: true }
})
