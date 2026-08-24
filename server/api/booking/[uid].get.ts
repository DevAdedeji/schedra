import { findBookingByUid } from '../../utils/booking-manage'
import { readBookingAnswers } from '../../utils/booking-answers'

export default defineEventHandler(async (event) => {
  const uid = getRouterParam(event, 'uid')

  if (!uid) {
    throw createError({ statusCode: 400, statusMessage: 'Missing booking' })
  }

  const booking = await findBookingByUid(uid)

  if (!booking) {
    throw createError({ statusCode: 404, statusMessage: 'No such booking' })
  }

  const answers = readBookingAnswers(booking.answers)
  return {
    uid: booking.uid,
    status: booking.status,
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    attendeeName: booking.attendeeName,
    attendeeEmail: booking.attendeeEmail,
    attendeeTimeZone: booking.attendeeTimeZone,
    locationType: booking.locationType,
    locationDetails: booking.locationDetails,
    meetingUrl: booking.meetingUrl,
    cancellationReason: booking.cancellationReason,
    eventTitle: booking.eventTitle,
    eventSlug: booking.eventSlug,
    durationMinutes: booking.durationMinutes,
    hostName: booking.hostName,
    hostUsername: booking.hostUsername,
    notes: answers.notes ?? null,
    answers: answers.responses
  }
})
