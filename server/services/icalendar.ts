import type { ManagedBooking } from '../repositories/booking'
import { meetingLocationText } from './booking-emails'

function escape(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function utc(date: Date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function fold(line: string) {
  const chunks: string[] = []
  let rest = line
  while (Buffer.byteLength(rest, 'utf8') > 73) {
    let end = 73
    while (Buffer.byteLength(rest.slice(0, end), 'utf8') > 73) end--
    chunks.push(rest.slice(0, end))
    rest = ` ${rest.slice(end)}`
  }
  chunks.push(rest)
  return chunks.join('\r\n')
}

export function bookingCalendarFile(booking: ManagedBooking, origin: string) {
  const manageUrl = `${origin}/booking/${booking.uid}`
  const where = meetingLocationText(
    booking.locationType,
    booking.locationDetails,
    booking.meetingUrl
  )
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Schedra//Booking//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${booking.status === 'cancelled' ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:${escape(booking.uid)}@schedra`,
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${utc(booking.startsAt)}`,
    `DTEND:${utc(booking.endsAt)}`,
    `SUMMARY:${escape(`${booking.eventTitle} with ${booking.hostName}`)}`,
    `DESCRIPTION:${escape(`Meeting with ${booking.hostName}. Manage this booking: ${manageUrl}`)}`,
    `LOCATION:${escape(where)}`,
    `URL:${escape(booking.meetingUrl ?? manageUrl)}`,
    `STATUS:${booking.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ]
  return `${lines.map(fold).join('\r\n')}\r\n`
}
