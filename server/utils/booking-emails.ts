import type { ManagedBooking } from './booking-manage'
import { enqueueEmails, type EmailInsertExecutor } from './email-outbox'
import { useEnv } from './env'
import type { BookingAnswer, MeetingLocationType } from '#shared/validation'

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
  answers?: BookingAnswer[]
  notes?: string | null
}

function whenRange(startsAt: string, endsAt: string, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone
  })
  return formatter.formatRange(new Date(startsAt), new Date(endsAt))
}

function locationUrl(type: MeetingLocationType, details: string, meetingUrl?: string | null) {
  if (type === 'google_meet') return meetingUrl ?? undefined
  if (type === 'video_link') return details
  return undefined
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
        preheader: `${booking.eventTitle} is confirmed with ${booking.hostName}.`,
        heading: 'You are booked',
        body: `Your meeting with ${booking.hostName} is confirmed. Everything you need is below, with the time shown in your timezone.`,
        details: [
          { label: 'Meeting', value: booking.eventTitle },
          { label: 'When', value: whenRange(booking.startsAt, booking.endsAt, booking.attendeeTimeZone) },
          { label: 'With', value: booking.hostName },
          {
            label: 'Where',
            value: meetingLocationText(booking.locationType, booking.locationDetails, booking.meetingUrl),
            url: locationUrl(booking.locationType, booking.locationDetails, booking.meetingUrl)
          }
        ],
        action: { label: 'View details or add to calendar', url: manage },
        footer: 'Plans change. You can reschedule or cancel from the booking page without contacting the host.'
      }
    },
    {
      dedupeKey: `booking:${booking.uid}:created:host`,
      email: {
        to: booking.hostEmail,
        subject: `New booking: ${booking.eventTitle}`,
        preheader: `${booking.attendeeName} booked ${booking.eventTitle}.`,
        heading: `${booking.attendeeName} booked you`,
        body: 'A new meeting has been added to your schedule. The time below is shown in your timezone.',
        details: [
          { label: 'Meeting', value: booking.eventTitle },
          { label: 'When', value: whenRange(booking.startsAt, booking.endsAt, booking.hostTimeZone) },
          { label: 'Guest', value: booking.attendeeName },
          { label: 'Guest email', value: booking.attendeeEmail },
          ...(booking.answers ?? []).map(answer => ({ label: answer.label, value: answer.value })),
          ...(booking.notes ? [{ label: 'Notes', value: booking.notes }] : []),
          {
            label: 'Where',
            value: meetingLocationText(booking.locationType, booking.locationDetails, booking.meetingUrl),
            url: locationUrl(booking.locationType, booking.locationDetails, booking.meetingUrl)
          }
        ],
        action: { label: 'View the booking', url: manage },
        footer: 'Schedra will keep the booking and your connected calendar in sync.'
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
          preheader: `${booking.eventTitle} with ${booking.hostName} is ${timing}.`,
          heading: `Your meeting is ${timing}`,
          body: `Here is a quick reminder about your upcoming meeting with ${booking.hostName}. The time below is shown in your timezone.`,
          details: [
            { label: 'Meeting', value: booking.eventTitle },
            { label: 'When', value: whenRange(booking.startsAt, booking.endsAt, booking.attendeeTimeZone) },
            { label: 'With', value: booking.hostName },
            {
              label: 'Where',
              value: meetingLocationText(booking.locationType, booking.locationDetails, booking.meetingUrl),
              url: locationUrl(booking.locationType, booking.locationDetails, booking.meetingUrl)
            }
          ],
          action: { label: 'View or join the meeting', url: manage },
          footer: 'Need a different time? You can reschedule or cancel from the booking page.'
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
        preheader: `${booking.eventTitle} with ${booking.hostName} has been cancelled.`,
        heading: guestHeading,
        body: 'This meeting is no longer taking place. It has been removed from the schedule and no further action is required.',
        details: [
          { label: 'Meeting', value: booking.eventTitle },
          { label: 'Was scheduled', value: whenRange(booking.startsAt.toISOString(), booking.endsAt.toISOString(), booking.attendeeTimeZone) },
          { label: 'With', value: booking.hostName },
          ...(reason ? [{ label: 'Reason', value: reason }] : [])
        ],
        action: { label: 'Book another time', url: `${useEnv().schedraUrl}/${booking.hostUsername}` },
        footer: 'If you still need to meet, choose a new time from the host’s booking page.'
      }
    },
    {
      dedupeKey: `booking:${booking.uid}:cancelled:host`,
      email: {
        to: booking.hostEmail,
        subject: `Cancelled: ${booking.eventTitle}`,
        preheader: `${booking.eventTitle} with ${booking.attendeeName} has been cancelled.`,
        heading: hostHeading,
        body: 'This meeting has been cancelled and the time is available on your schedule again.',
        details: [
          { label: 'Meeting', value: booking.eventTitle },
          { label: 'Was scheduled', value: whenRange(booking.startsAt.toISOString(), booking.endsAt.toISOString(), booking.hostTimeZone) },
          { label: 'Guest', value: booking.attendeeName },
          { label: 'Guest email', value: booking.attendeeEmail },
          ...(reason ? [{ label: 'Reason', value: reason }] : [])
        ],
        action: { label: 'See your bookings', url: `${useEnv().schedraUrl}/dashboard` },
        footer: 'Schedra has also queued the matching connected-calendar update.'
      }
    }
  ], executor)
}
