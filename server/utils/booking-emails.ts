import type { ManagedBooking } from './booking-manage'
import { enqueueEmails, type EmailInsertExecutor } from './email-outbox'
import { useEnv } from './env'
import type { MeetingLocationType } from '#shared/validation'

export interface BookingNotice {
  uid: string
  eventTitle: string
  hostName: string
  hostEmail: string
  hostTimeZone: string
  attendeeName: string
  attendeeEmail: string
  attendeeTimeZone: string
  startsAt: string
  endsAt: string
  locationType: MeetingLocationType
  locationDetails: string
  meetingUrl?: string | null
  reminderMinutes: number[]
}

function when(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone
  }).format(new Date(iso))
}

export function meetingLocationText(
  type: MeetingLocationType,
  details: string,
  meetingUrl?: string | null
) {
  if (type === 'google_meet') return meetingUrl ? `Google Meet: ${meetingUrl}` : 'Google Meet — the join link will appear in the booking details.'
  if (type === 'video_link') return `Video call: ${details}`
  if (type === 'phone') return `Phone call: ${details}`
  if (type === 'in_person') return `In person: ${details}`
  return details
}

export async function queueBookingEmails(booking: BookingNotice, executor?: EmailInsertExecutor) {
  const manage = `${useEnv().schedraUrl}/booking/${booking.uid}`

  await enqueueEmails([
    {
      dedupeKey: `booking:${booking.uid}:created:guest`,
      email: {
        to: booking.attendeeEmail,
        subject: `Confirmed: ${booking.eventTitle} with ${booking.hostName}`,
        heading: 'You are booked',
        body: `${when(booking.startsAt, booking.attendeeTimeZone)} — shown in your own timezone. ${meetingLocationText(booking.locationType, booking.locationDetails, booking.meetingUrl)}`,
        action: { label: 'View details or add to calendar', url: manage },
        footer: 'Plans change. You can cancel or move it from that link.'
      }
    },
    {
      dedupeKey: `booking:${booking.uid}:created:host`,
      email: {
        to: booking.hostEmail,
        subject: `New booking: ${booking.eventTitle}`,
        heading: `${booking.attendeeName} booked you`,
        body: `${when(booking.startsAt, booking.hostTimeZone)} — shown in your timezone. ${meetingLocationText(booking.locationType, booking.locationDetails, booking.meetingUrl)}`,
        action: { label: 'View the booking', url: manage },
        footer: `Guest email: ${booking.attendeeEmail}`
      }
    },
    ...booking.reminderMinutes.flatMap((minutes) => {
      const availableAt = new Date(new Date(booking.startsAt).getTime() - minutes * 60_000)
      if (availableAt.getTime() <= Date.now()) return []
      const timing = minutes === 60
        ? 'in 1 hour'
        : minutes === 1440
          ? 'tomorrow'
          : `in ${Math.round(minutes / 60)} hours`
      return [{
        dedupeKey: `booking:${booking.uid}:reminder:${minutes}:guest`,
        bookingUid: booking.uid,
        category: 'booking_reminder' as const,
        availableAt,
        email: {
          to: booking.attendeeEmail,
          subject: `Reminder: ${booking.eventTitle} is ${timing}`,
          heading: `Your meeting is ${timing}`,
          body: `${when(booking.startsAt, booking.attendeeTimeZone)} — shown in your own timezone. ${meetingLocationText(booking.locationType, booking.locationDetails, booking.meetingUrl)}`,
          action: { label: 'View meeting details', url: manage },
          footer: `Meeting with ${booking.hostName}. You can move or cancel it from the booking page.`
        }
      }]
    })
  ], executor)
}

export async function queueCancellationEmails(
  booking: ManagedBooking,
  reason?: string,
  actor: 'guest' | 'host' = 'guest',
  executor?: EmailInsertExecutor
) {
  const because = reason ? ` Reason given: ${reason}` : ''
  const guestHeading = actor === 'host'
    ? `${booking.hostName} cancelled the meeting`
    : 'That meeting is cancelled'
  const hostHeading = actor === 'host'
    ? `You cancelled ${booking.attendeeName}'s booking`
    : `${booking.attendeeName} cancelled`

  await enqueueEmails([
    {
      dedupeKey: `booking:${booking.uid}:cancelled:guest`,
      email: {
        to: booking.attendeeEmail,
        subject: `Cancelled: ${booking.eventTitle} with ${booking.hostName}`,
        heading: guestHeading,
        body: `${when(booking.startsAt.toISOString(), booking.attendeeTimeZone)} is no longer happening.${because}`,
        action: { label: 'Book another time', url: `${useEnv().schedraUrl}/${booking.hostUsername}` },
        footer: 'Nothing further is needed from you.'
      }
    },
    {
      dedupeKey: `booking:${booking.uid}:cancelled:host`,
      email: {
        to: booking.hostEmail,
        subject: `Cancelled: ${booking.eventTitle}`,
        heading: hostHeading,
        body: `${when(booking.startsAt.toISOString(), booking.hostTimeZone)} is free again.${because}`,
        action: { label: 'See your bookings', url: `${useEnv().schedraUrl}/dashboard` },
        footer: `Guest email: ${booking.attendeeEmail}`
      }
    }
  ], executor)
}
