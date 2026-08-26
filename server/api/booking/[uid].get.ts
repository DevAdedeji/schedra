import { assignedHostsForBooking, findBookingByUid } from '../../repositories/booking'
import { readBookingAnswers } from '../../domain/booking-answers'
import { getAuthSession } from '../../services/session'

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
  const session = await getAuthSession(event)
  const assignedHosts = await assignedHostsForBooking(booking.id)
  const bookingPath = booking.organizationSlug
    ? `/team/${encodeURIComponent(booking.organizationSlug)}/${encodeURIComponent(booking.eventSlug)}`
    : `/${encodeURIComponent(booking.hostUsername)}/${encodeURIComponent(booking.eventSlug)}`
  return {
    uid: booking.uid,
    status: booking.status,
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    attendeeName: booking.attendeeName,
    attendeeEmail: booking.attendeeEmail,
    attendeeTimeZone: booking.attendeeTimeZone,
    additionalGuestEmails: booking.additionalGuestEmails,
    locationType: booking.locationType,
    locationDetails: booking.locationDetails,
    meetingUrl: booking.meetingUrl,
    cancellationReason: booking.cancellationReason,
    eventTitle: booking.eventTitle,
    eventSlug: booking.eventSlug,
    durationMinutes: booking.durationMinutes,
    hostName: booking.hostName,
    hostUsername: booking.hostUsername,
    teamName: booking.organizationName,
    teamSlug: booking.organizationSlug,
    bookingPath,
    hosts: assignedHosts.map(host => ({ name: host.name, isOrganizer: host.isOrganizer })),
    notes: answers.notes ?? null,
    answers: answers.responses,
    canHostManage: assignedHosts.some(host => host.userId === session?.user.id)
  }
})
