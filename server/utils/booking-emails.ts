import type { ManagedBooking } from './booking-manage'
import { enqueueEmails, type EmailInsertExecutor } from './email-outbox'
import { useEnv } from './env'

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

export async function queueBookingEmails(booking: BookingNotice, executor?: EmailInsertExecutor) {
  const manage = `${useEnv().schedraUrl}/booking/${booking.uid}`

  await enqueueEmails([
    {
      dedupeKey: `booking:${booking.uid}:created:guest`,
      email: {
        to: booking.attendeeEmail,
        subject: `Confirmed: ${booking.eventTitle} with ${booking.hostName}`,
        heading: 'You are booked',
        body: `${when(booking.startsAt, booking.attendeeTimeZone)} — shown in your own timezone.`,
        action: { label: 'View or cancel', url: manage },
        footer: 'Plans change. You can cancel or move it from that link.'
      }
    },
    {
      dedupeKey: `booking:${booking.uid}:created:host`,
      email: {
        to: booking.hostEmail,
        subject: `New booking: ${booking.eventTitle}`,
        heading: `${booking.attendeeName} booked you`,
        body: `${when(booking.startsAt, booking.hostTimeZone)} — shown in your timezone.`,
        action: { label: 'View the booking', url: manage },
        footer: `Guest email: ${booking.attendeeEmail}`
      }
    }
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
