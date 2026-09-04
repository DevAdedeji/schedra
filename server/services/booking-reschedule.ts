import { findBookingByUid } from '../repositories/booking'

/** A booking UID is a management capability, never an arbitrary exclusion ID. */
export async function bookingToReschedule(uid: string | undefined, eventTypeId: string, attendeeEmail?: string) {
  if (!uid) return null
  const booking = await findBookingByUid(uid)
  if (!booking || booking.eventTypeId !== eventTypeId) {
    throw createError({ statusCode: 404, statusMessage: 'No such booking to move' })
  }
  if (!['pending', 'confirmed'].includes(booking.status) || booking.endsAt <= new Date()) {
    throw createError({ statusCode: 409, statusMessage: 'That booking can no longer be moved.' })
  }
  if (attendeeEmail && booking.attendeeEmail.toLowerCase() !== attendeeEmail.toLowerCase()) {
    throw createError({ statusCode: 409, statusMessage: 'Use the email address already attached to this booking.' })
  }
  return booking
}
