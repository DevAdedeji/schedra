import type { ManagedBooking } from './booking-manage'
import { sendEmail } from './email'
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

/**
 * Never throws. The booking is already committed by the time this runs, so a
 * refused email must not turn a successful booking into an error the guest
 * would retry — that is how duplicate bookings get made.
 */
export async function sendBookingEmails(booking: BookingNotice) {
  const { schedraUrl } = useEnv()
  const manage = `${schedraUrl}/booking/${booking.uid}`

  const results = await Promise.allSettled([
    sendEmail({
      to: booking.attendeeEmail,
      subject: `Confirmed: ${booking.eventTitle} with ${booking.hostName}`,
      heading: 'You are booked',
      body: `${when(booking.startsAt, booking.attendeeTimeZone)} — shown in your own timezone.`,
      action: { label: 'View or cancel', url: manage },
      footer: 'Plans change. You can cancel or move it from that link.'
    }),
    sendEmail({
      to: booking.hostEmail,
      subject: `New booking: ${booking.eventTitle}`,
      heading: `${booking.attendeeName} booked you`,
      body: `${when(booking.startsAt, booking.hostTimeZone)} — shown in your timezone.`,
      action: { label: 'View the booking', url: manage },
      footer: `Guest email: ${booking.attendeeEmail}`
    })
  ])

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error(`[booking ${booking.uid}] email failed:`, result.reason)
    }
  }
}

export async function sendCancellationEmails(booking: ManagedBooking, reason?: string) {
  const because = reason ? ` Reason given: ${reason}` : ''

  const results = await Promise.allSettled([
    sendEmail({
      to: booking.attendeeEmail,
      subject: `Cancelled: ${booking.eventTitle} with ${booking.hostName}`,
      heading: 'That meeting is cancelled',
      body: `${when(booking.startsAt.toISOString(), booking.attendeeTimeZone)} is no longer happening.${because}`,
      action: { label: `Book another time`, url: `${useEnv().schedraUrl}/${booking.hostUsername}` },
      footer: 'Nothing further is needed from you.'
    }),
    sendEmail({
      to: booking.hostEmail,
      subject: `Cancelled: ${booking.eventTitle}`,
      heading: `${booking.attendeeName} cancelled`,
      body: `${when(booking.startsAt.toISOString(), booking.hostTimeZone)} is free again.${because}`,
      action: { label: 'See your bookings', url: `${useEnv().schedraUrl}/dashboard` },
      footer: `Guest email: ${booking.attendeeEmail}`
    })
  ])

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error(`[booking ${booking.uid}] cancellation email failed:`, result.reason)
    }
  }
}
