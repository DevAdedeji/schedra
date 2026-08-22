import { eq } from 'drizzle-orm'
import { cancelBookingSchema } from '#shared/validation'
import { bookings } from '../../../database/schema'
import { useDatabase } from '../../../utils/database'
import { findBookingByUid } from '../../../utils/booking-manage'
import { sendCancellationEmails } from '../../../utils/booking-emails'

export default defineEventHandler(async (event) => {
  const uid = getRouterParam(event, 'uid')
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

  await useDatabase()
    .update(bookings)
    .set({
      status: 'cancelled',
      cancellationReason: parsed.data.reason || null,
      updatedAt: new Date()
    })
    .where(eq(bookings.id, booking.id))

  await sendCancellationEmails(booking, parsed.data.reason)

  return { ok: true, alreadyCancelled: false }
})
