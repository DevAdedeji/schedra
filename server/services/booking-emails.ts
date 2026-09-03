import type { AssignedBookingHost, ManagedBooking } from '../repositories/booking'
import { emailDedupeKey, enqueueEmails, type EmailInsertExecutor } from './email-outbox'
import { useEnv } from '../config/env'
import type { BookingAnswer, MeetingLocationType } from '#shared/validation'
import { readBookingAnswers } from '../domain/booking-answers'
import { subtractFromInstant } from '../utils/date-time'
import { useDatabase } from '../database'
import {
  optionalHostRecipients,
  type NotificationPreferenceExecutor
} from './email-notification-preferences'

export interface BookingNotice {
  uid: string
  eventTitle: string
  hostName: string
  hostUserId?: string
  hostEmail: string
  hostUsername: string
  hostTimeZone: string
  attendeeName: string
  attendeeEmail: string
  additionalGuestEmails: string[]
  attendeeTimeZone: string
  startsAt: string
  endsAt: string
  locationType: MeetingLocationType
  locationDetails: string
  meetingUrl?: string | null
  reminderMinutes: number[]
  answers?: BookingAnswer[]
  notes?: string | null
  hostRecipients?: BookingHostRecipient[]
  publicBookingPath?: string
  series?: {
    frequency: 'weekly' | 'biweekly' | 'monthly' | 'yearly'
    occurrenceCount: number
    occurrences: Array<{ startsAt: string, endsAt: string }>
  }
}

interface QueueBookingEmailOptions {
  sendConfirmation?: boolean
}

export interface BookingRescheduleDetails {
  previousStartsAt: string
  previousEndsAt: string
  requiresConfirmation: boolean
  seriesPosition?: number | null
  previousHostRecipients?: BookingHostRecipient[]
}

export interface BookingHostRecipient {
  userId?: string
  name: string
  email: string
  timeZone: string
  isOrganizer: boolean
}

export type BookingEmailExecutor = EmailInsertExecutor & NotificationPreferenceExecutor

function fallbackHost(booking: Pick<BookingNotice, 'hostName' | 'hostUserId' | 'hostEmail' | 'hostTimeZone'>): BookingHostRecipient {
  return {
    userId: booking.hostUserId,
    name: booking.hostName,
    email: booking.hostEmail,
    timeZone: booking.hostTimeZone,
    isOrganizer: true
  }
}

function publicBookingPath(booking: ManagedBooking) {
  return booking.organizationSlug
    ? `/team/${encodeURIComponent(booking.organizationSlug)}/${encodeURIComponent(booking.eventSlug)}`
    : `/${encodeURIComponent(booking.hostUsername)}/${encodeURIComponent(booking.eventSlug)}`
}

export function bookingNoticeFromManaged(
  booking: ManagedBooking,
  hosts: AssignedBookingHost[] = []
): BookingNotice {
  const answers = readBookingAnswers(booking.answers)
  return {
    uid: booking.uid,
    eventTitle: booking.eventTitle,
    hostName: booking.hostName,
    hostUserId: booking.hostId,
    hostEmail: booking.hostEmail,
    hostUsername: booking.hostUsername,
    hostTimeZone: booking.hostTimeZone,
    attendeeName: booking.attendeeName,
    attendeeEmail: booking.attendeeEmail,
    additionalGuestEmails: booking.additionalGuestEmails,
    attendeeTimeZone: booking.attendeeTimeZone,
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    locationType: booking.locationType,
    locationDetails: booking.locationDetails,
    meetingUrl: booking.meetingUrl,
    reminderMinutes: booking.reminderMinutes,
    answers: answers.responses,
    notes: answers.notes,
    hostRecipients: hosts.length ? hosts : undefined,
    publicBookingPath: publicBookingPath(booking)
  }
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
  if (['google_meet', 'microsoft_teams', 'zoom'].includes(type)) return meetingUrl ?? undefined
  if (type === 'video_link') return details
  return undefined
}

export function meetingLocationText(
  type: MeetingLocationType,
  details: string,
  meetingUrl?: string | null
) {
  if (type === 'google_meet') return meetingUrl ? `Google Meet: ${meetingUrl}` : 'Google Meet — the join link will appear in the booking details.'
  if (type === 'microsoft_teams') return meetingUrl ? `Microsoft Teams: ${meetingUrl}` : 'Microsoft Teams — the join link will appear in the booking details.'
  if (type === 'zoom') return meetingUrl ? `Zoom: ${meetingUrl}` : 'Zoom — the join link will appear in the booking details.'
  if (type === 'video_link') return `Video call: ${details}`
  if (type === 'phone') return `Phone call: ${details}`
  if (type === 'in_person') return `In person: ${details}`
  return details
}

export async function queueBookingEmails(
  booking: BookingNotice,
  executor?: BookingEmailExecutor,
  options: QueueBookingEmailOptions = {}
) {
  const manage = `${useEnv().schedraUrl}/booking/${booking.uid}`
  const hostPage = `${useEnv().schedraUrl}${booking.publicBookingPath ?? `/${booking.hostUsername}`}`
  const recipients = [booking.attendeeEmail, ...booking.additionalGuestEmails]
  const hosts = booking.hostRecipients?.length ? booking.hostRecipients : [fallbackHost(booking)]
  const notifiedHosts = await optionalHostRecipients(hosts, 'newBookingEmails', executor ?? useDatabase())
  const sendConfirmation = options.sendConfirmation ?? true
  const seriesLabel = booking.series?.frequency === 'biweekly'
    ? 'Every 2 weeks'
    : booking.series
      ? `${booking.series.frequency[0]?.toUpperCase()}${booking.series.frequency.slice(1)}`
      : null
  await enqueueEmails([
    ...(sendConfirmation
      ? recipients.map((recipient, index) => ({
          dedupeKey: index === 0
            ? `booking:${booking.uid}:created:guest`
            : emailDedupeKey(`booking:${booking.uid}:created:additional`, recipient),
          email: {
            to: recipient,
            subject: booking.series
              ? `Confirmed: ${booking.series.occurrenceCount} ${booking.eventTitle} meetings`
              : `Confirmed: ${booking.eventTitle} with ${booking.hostName}`,
            preheader: booking.series
              ? `${booking.series.occurrenceCount} meetings are confirmed with ${booking.hostName}.`
              : `${booking.eventTitle} is confirmed with ${booking.hostName}.`,
            heading: booking.series
              ? `${booking.series.occurrenceCount} meetings booked`
              : 'You are booked',
            body: booking.series
              ? `Your recurring meetings with ${booking.hostName} are confirmed. Every date below is shown in your timezone.`
              : `Your meeting with ${booking.hostName} is confirmed. Everything you need is below, with the time shown in your timezone.`,
            details: [
              { label: 'Meeting', value: booking.eventTitle },
              ...(booking.series
                ? [
                    { label: 'Repeats', value: seriesLabel! },
                    ...booking.series.occurrences.map((occurrence, index) => ({
                      label: `Meeting ${index + 1}`,
                      value: whenRange(occurrence.startsAt, occurrence.endsAt, booking.attendeeTimeZone)
                    }))
                  ]
                : [{ label: 'When', value: whenRange(booking.startsAt, booking.endsAt, booking.attendeeTimeZone) }]),
              { label: 'With', value: booking.hostName },
              {
                label: 'Where',
                value: meetingLocationText(booking.locationType, booking.locationDetails, booking.meetingUrl),
                url: locationUrl(booking.locationType, booking.locationDetails, booking.meetingUrl)
              }
            ],
            action: index === 0
              ? { label: 'View details or add to calendar', url: manage }
              : { label: 'View the host’s booking page', url: hostPage },
            footer: index === 0
              ? booking.series
                ? 'Each meeting can be rescheduled or cancelled separately from its booking page.'
                : 'Plans change. You can reschedule or cancel from the booking page without contacting the host.'
              : 'The person who made the booking can reschedule or cancel it. You will receive any updates automatically.'
          }
        }))
      : []),
    ...(sendConfirmation
      ? notifiedHosts.map((host, index) => ({
          dedupeKey: index === 0
            ? `booking:${booking.uid}:created:host`
            : emailDedupeKey(`booking:${booking.uid}:created:cohost`, host.email),
          email: {
            to: host.email,
            subject: booking.series
              ? `New recurring booking: ${booking.eventTitle}`
              : `New booking: ${booking.eventTitle}`,
            preheader: booking.series
              ? `${booking.attendeeName} booked ${booking.series.occurrenceCount} meetings.`
              : `${booking.attendeeName} booked ${booking.eventTitle}.`,
            heading: booking.series
              ? `${booking.attendeeName} booked ${booking.series.occurrenceCount} meetings`
              : `${booking.attendeeName} booked ${hosts.length > 1 ? 'your team' : 'you'}`,
            body: booking.series
              ? 'A recurring series has been added to your schedule. Every date below is shown in your timezone.'
              : 'A new meeting has been added to your schedule. The time below is shown in your timezone.',
            details: [
              { label: 'Meeting', value: booking.eventTitle },
              ...(booking.series
                ? [
                    { label: 'Repeats', value: seriesLabel! },
                    ...booking.series.occurrences.map((occurrence, index) => ({
                      label: `Meeting ${index + 1}`,
                      value: whenRange(occurrence.startsAt, occurrence.endsAt, host.timeZone)
                    }))
                  ]
                : [{ label: 'When', value: whenRange(booking.startsAt, booking.endsAt, host.timeZone) }]),
              { label: 'Guest', value: booking.attendeeName },
              { label: 'Guest email', value: booking.attendeeEmail },
              ...(booking.additionalGuestEmails.length
                ? [{ label: 'Additional guests', value: booking.additionalGuestEmails.join(', ') }]
                : []),
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
        }))
      : []),
    ...booking.reminderMinutes.flatMap((minutes) => {
      const availableAt = subtractFromInstant(booking.startsAt, { minutes })
      if (availableAt.getTime() <= Date.now()) return []
      const timing = minutes === 60
        ? 'in 1 hour'
        : minutes === 1440
          ? 'tomorrow'
          : `in ${Math.round(minutes / 60)} hours`
      return recipients.map((recipient, index) => ({
        dedupeKey: index === 0
          ? `booking:${booking.uid}:reminder:${minutes}:guest`
          : emailDedupeKey(`booking:${booking.uid}:reminder:${minutes}:additional`, recipient),
        bookingUid: booking.uid,
        category: 'booking_reminder' as const,
        availableAt,
        email: {
          to: recipient,
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
          action: index === 0
            ? { label: 'View or join the meeting', url: manage }
            : { label: 'View the host’s booking page', url: hostPage },
          footer: index === 0
            ? 'Need a different time? You can reschedule or cancel from the booking page.'
            : 'The person who made the booking manages changes for everyone invited.'
        }
      }))
    })
  ], executor)
}

export async function queueBookingRescheduledEmails(
  booking: BookingNotice,
  reschedule: BookingRescheduleDetails,
  executor?: BookingEmailExecutor
) {
  const manage = `${useEnv().schedraUrl}/booking/${booking.uid}`
  const hostPage = `${useEnv().schedraUrl}${booking.publicBookingPath ?? `/${booking.hostUsername}`}`
  const recipients = [booking.attendeeEmail, ...booking.additionalGuestEmails]
  const hosts = booking.hostRecipients?.length ? booking.hostRecipients : [fallbackHost(booking)]
  const currentHostEmails = new Set(hosts.map(host => host.email.toLowerCase()))
  const previousOnlyHosts = (reschedule.previousHostRecipients ?? [])
    .filter(host => !currentHostEmails.has(host.email.toLowerCase()))
  const notifiedHosts = await optionalHostRecipients(hosts, 'rescheduleEmails', executor ?? useDatabase())
  const notifiedPreviousOnlyHosts = await optionalHostRecipients(
    previousOnlyHosts,
    'rescheduleEmails',
    executor ?? useDatabase()
  )
  const seriesDetail = reschedule.seriesPosition
    ? [{ label: 'Recurring meeting', value: `Meeting ${reschedule.seriesPosition} in the series` }]
    : []
  const guestState = reschedule.requiresConfirmation
    ? {
        subject: `Reschedule requested: ${booking.eventTitle} with ${booking.hostName}`,
        preheader: `${booking.hostName} will review the new time.`,
        heading: 'Your new time is awaiting approval',
        body: `Your previous time has been released. ${booking.hostName} will review the new time shown below.`,
        footer: 'You will receive another email as soon as the host approves or declines the new time.'
      }
    : {
        subject: `Rescheduled: ${booking.eventTitle} with ${booking.hostName}`,
        preheader: `${booking.eventTitle} has moved to a new time.`,
        heading: 'Your meeting has been rescheduled',
        body: `Your meeting with ${booking.hostName} is confirmed at the new time below.`,
        footer: 'Your previous time has been released. Schedra will keep the new booking and connected calendars in sync.'
      }

  await enqueueEmails([
    ...recipients.map((recipient, index) => ({
      dedupeKey: index === 0
        ? `booking:${booking.uid}:rescheduled:guest`
        : emailDedupeKey(`booking:${booking.uid}:rescheduled:additional`, recipient),
      email: {
        to: recipient,
        ...guestState,
        details: [
          { label: 'Meeting', value: booking.eventTitle },
          ...seriesDetail,
          { label: 'Previous time', value: whenRange(reschedule.previousStartsAt, reschedule.previousEndsAt, booking.attendeeTimeZone) },
          { label: reschedule.requiresConfirmation ? 'Requested time' : 'New time', value: whenRange(booking.startsAt, booking.endsAt, booking.attendeeTimeZone) },
          { label: 'With', value: booking.hostName },
          {
            label: 'Where',
            value: meetingLocationText(booking.locationType, booking.locationDetails, booking.meetingUrl),
            url: locationUrl(booking.locationType, booking.locationDetails, booking.meetingUrl)
          }
        ],
        action: index === 0
          ? { label: reschedule.requiresConfirmation ? 'View the request' : 'View updated booking', url: manage }
          : { label: 'View the host’s booking page', url: hostPage }
      }
    })),
    ...notifiedHosts.map((host, index) => ({
      dedupeKey: index === 0
        ? `booking:${booking.uid}:rescheduled:host`
        : emailDedupeKey(`booking:${booking.uid}:rescheduled:cohost`, host.email),
      email: {
        to: host.email,
        subject: reschedule.requiresConfirmation
          ? `Approval needed: reschedule for ${booking.eventTitle}`
          : `Rescheduled: ${booking.eventTitle} with ${booking.attendeeName}`,
        preheader: reschedule.requiresConfirmation
          ? `${booking.attendeeName} requested a new time.`
          : `${booking.attendeeName} moved ${booking.eventTitle} to a new time.`,
        heading: reschedule.requiresConfirmation
          ? `${booking.attendeeName} requested a new time`
          : 'The booking has moved',
        body: reschedule.requiresConfirmation
          ? 'The previous time has been released. Review the requested time below before approving or declining it.'
          : 'The previous time has been released and the new time has been added to your schedule.',
        details: [
          { label: 'Meeting', value: booking.eventTitle },
          ...seriesDetail,
          { label: 'Previous time', value: whenRange(reschedule.previousStartsAt, reschedule.previousEndsAt, host.timeZone) },
          { label: reschedule.requiresConfirmation ? 'Requested time' : 'New time', value: whenRange(booking.startsAt, booking.endsAt, host.timeZone) },
          { label: 'Guest', value: booking.attendeeName },
          { label: 'Guest email', value: booking.attendeeEmail },
          ...(booking.additionalGuestEmails.length
            ? [{ label: 'Additional guests', value: booking.additionalGuestEmails.join(', ') }]
            : []),
          ...(booking.answers ?? []).map(answer => ({ label: answer.label, value: answer.value })),
          ...(booking.notes ? [{ label: 'Notes', value: booking.notes }] : [])
        ],
        action: { label: reschedule.requiresConfirmation ? 'Review requested time' : 'View updated booking', url: manage },
        footer: reschedule.requiresConfirmation
          ? 'Approving creates the calendar event; declining releases the requested time.'
          : 'Schedra will keep the updated booking and connected calendars in sync.'
      }
    })),
    ...notifiedPreviousOnlyHosts.map(host => ({
      dedupeKey: emailDedupeKey(`booking:${booking.uid}:rescheduled:previous-host`, host.email),
      email: {
        to: host.email,
        subject: `Booking moved: ${booking.eventTitle} with ${booking.attendeeName}`,
        preheader: `${booking.eventTitle} is no longer assigned to you.`,
        heading: 'This booking moved off your schedule',
        body: 'The guest chose a new time and the team assigned another host. Your previous calendar event will be removed.',
        details: [
          { label: 'Meeting', value: booking.eventTitle },
          ...seriesDetail,
          { label: 'Previous time', value: whenRange(reschedule.previousStartsAt, reschedule.previousEndsAt, host.timeZone) },
          { label: 'Guest', value: booking.attendeeName }
        ],
        action: { label: 'View team booking page', url: hostPage },
        footer: 'You do not need to take any action.'
      }
    }))
  ], executor)
}

export async function queueBookingRequestEmails(booking: BookingNotice, executor?: BookingEmailExecutor) {
  const manage = `${useEnv().schedraUrl}/booking/${booking.uid}`
  const recipients = [booking.attendeeEmail, ...booking.additionalGuestEmails]
  const hosts = booking.hostRecipients?.length ? booking.hostRecipients : [fallbackHost(booking)]
  const notifiedHosts = await optionalHostRecipients(hosts, 'approvalRequestEmails', executor ?? useDatabase())
  const hostPage = `${useEnv().schedraUrl}${booking.publicBookingPath ?? `/${booking.hostUsername}`}`
  const guestDetails = [
    { label: 'Meeting', value: booking.eventTitle },
    { label: 'Requested time', value: whenRange(booking.startsAt, booking.endsAt, booking.attendeeTimeZone) },
    { label: 'With', value: booking.hostName }
  ]

  await enqueueEmails([
    ...recipients.map((recipient, index) => ({
      dedupeKey: index === 0
        ? `booking:${booking.uid}:requested:guest`
        : emailDedupeKey(`booking:${booking.uid}:requested:additional`, recipient),
      email: {
        to: recipient,
        subject: `Request sent: ${booking.eventTitle} with ${booking.hostName}`,
        preheader: `${booking.hostName} will review this booking request.`,
        heading: 'Your request is with the host',
        body: `${booking.hostName} will review the requested time. It is being held so nobody else can take it while you wait.`,
        details: guestDetails,
        action: index === 0
          ? { label: 'View or change the request', url: manage }
          : { label: 'View the host’s booking page', url: hostPage },
        footer: 'You will receive another email as soon as the host approves or declines the request.'
      }
    })),
    ...notifiedHosts.map((host, index) => ({
      dedupeKey: index === 0
        ? `booking:${booking.uid}:requested:host`
        : emailDedupeKey(`booking:${booking.uid}:requested:cohost`, host.email),
      email: {
        to: host.email,
        subject: `Approval needed: ${booking.eventTitle}`,
        preheader: `${booking.attendeeName} requested ${booking.eventTitle}.`,
        heading: `${booking.attendeeName} requested a meeting`,
        body: 'The requested time is reserved until you approve or decline it. Review the guest details below before responding.',
        details: [
          { label: 'Meeting', value: booking.eventTitle },
          { label: 'When', value: whenRange(booking.startsAt, booking.endsAt, host.timeZone) },
          { label: 'Guest', value: booking.attendeeName },
          { label: 'Guest email', value: booking.attendeeEmail },
          ...(booking.additionalGuestEmails.length ? [{ label: 'Additional guests', value: booking.additionalGuestEmails.join(', ') }] : []),
          ...(booking.answers ?? []).map(answer => ({ label: answer.label, value: answer.value })),
          ...(booking.notes ? [{ label: 'Notes', value: booking.notes }] : [])
        ],
        action: { label: 'Review booking request', url: manage },
        footer: 'Declining the request releases the time immediately.'
      }
    }))
  ], executor)
}

export async function queueBookingRejectedEmails(
  booking: ManagedBooking,
  reason?: string,
  executor?: BookingEmailExecutor,
  assignedHosts: AssignedBookingHost[] = []
) {
  const recipients = [booking.attendeeEmail, ...booking.additionalGuestEmails]
  const chooseAgain = `${useEnv().schedraUrl}${publicBookingPath(booking)}`
  const hosts = assignedHosts.length
    ? assignedHosts
    : [fallbackHost({
        hostName: booking.hostName,
        hostEmail: booking.hostEmail,
        hostTimeZone: booking.hostTimeZone
      })]
  const notifiedHosts = await optionalHostRecipients(hosts, 'approvalRequestEmails', executor ?? useDatabase())
  await enqueueEmails([
    ...recipients.map((recipient, index) => ({
      dedupeKey: index === 0
        ? `booking:${booking.uid}:rejected:guest`
        : emailDedupeKey(`booking:${booking.uid}:rejected:additional`, recipient),
      email: {
        to: recipient,
        subject: `Booking request declined: ${booking.eventTitle}`,
        preheader: `${booking.hostName} could not confirm the requested time.`,
        heading: 'That time was not confirmed',
        body: `${booking.hostName} could not confirm this booking request. The time has been released and you can choose another available slot.`,
        details: [
          { label: 'Meeting', value: booking.eventTitle },
          { label: 'Requested time', value: whenRange(booking.startsAt.toISOString(), booking.endsAt.toISOString(), booking.attendeeTimeZone) },
          ...(reason ? [{ label: 'Host’s note', value: reason }] : [])
        ],
        action: { label: 'Choose another time', url: chooseAgain },
        footer: 'No calendar event was created for this request.'
      }
    })),
    ...notifiedHosts.map((host, index) => ({
      dedupeKey: index === 0
        ? `booking:${booking.uid}:rejected:host`
        : emailDedupeKey(`booking:${booking.uid}:rejected:cohost`, host.email),
      email: {
        to: host.email,
        subject: `Declined: ${booking.eventTitle}`,
        preheader: `${booking.eventTitle} with ${booking.attendeeName} was declined.`,
        heading: 'The booking request was declined',
        body: 'The requested time has been released and is available for another booking.',
        details: [
          { label: 'Meeting', value: booking.eventTitle },
          { label: 'Requested time', value: whenRange(booking.startsAt.toISOString(), booking.endsAt.toISOString(), host.timeZone) },
          { label: 'Guest', value: booking.attendeeName },
          ...(reason ? [{ label: 'Reason', value: reason }] : [])
        ],
        action: { label: 'See team bookings', url: `${useEnv().schedraUrl}${booking.organizationSlug ? `/t/${booking.organizationSlug}/bookings` : '/bookings'}` },
        footer: 'No connected-calendar event was created for this request.'
      }
    }))
  ], executor)
}

export async function queueCancellationEmails(
  booking: ManagedBooking,
  reason?: string,
  actor: 'guest' | 'host' = 'guest',
  executor?: BookingEmailExecutor,
  assignedHosts: AssignedBookingHost[] = []
) {
  const guestHeading = actor === 'host'
    ? `${booking.hostName} cancelled the meeting`
    : 'That meeting is cancelled'
  const hostHeading = actor === 'host'
    ? assignedHosts.length > 1
      ? `A host cancelled ${booking.attendeeName}'s booking`
      : `You cancelled ${booking.attendeeName}'s booking`
    : `${booking.attendeeName} cancelled`

  const bookingPage = `${useEnv().schedraUrl}${publicBookingPath(booking)}`
  const hosts = assignedHosts.length
    ? assignedHosts
    : [fallbackHost({
        hostName: booking.hostName,
        hostEmail: booking.hostEmail,
        hostTimeZone: booking.hostTimeZone
      })]
  const notifiedHosts = await optionalHostRecipients(hosts, 'cancellationEmails', executor ?? useDatabase())

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
        action: { label: 'Book another time', url: bookingPage },
        footer: 'If you still need to meet, choose a new time from the host’s booking page.'
      }
    },
    ...booking.additionalGuestEmails.map(recipient => ({
      dedupeKey: emailDedupeKey(`booking:${booking.uid}:cancelled:additional`, recipient),
      email: {
        to: recipient,
        subject: `Cancelled: ${booking.eventTitle} with ${booking.hostName}`,
        preheader: `${booking.eventTitle} with ${booking.hostName} has been cancelled.`,
        heading: `${booking.eventTitle} is cancelled`,
        body: 'This meeting is no longer taking place and no further action is required.',
        details: [
          { label: 'Meeting', value: booking.eventTitle },
          { label: 'Was scheduled', value: whenRange(booking.startsAt.toISOString(), booking.endsAt.toISOString(), booking.attendeeTimeZone) },
          { label: 'With', value: booking.hostName },
          ...(reason ? [{ label: 'Reason', value: reason }] : [])
        ],
        action: { label: 'View the host’s booking page', url: bookingPage },
        footer: 'You were included as an additional guest on this booking.'
      }
    })),
    ...notifiedHosts.map((host, index) => ({
      dedupeKey: index === 0
        ? `booking:${booking.uid}:cancelled:host`
        : emailDedupeKey(`booking:${booking.uid}:cancelled:cohost`, host.email),
      email: {
        to: host.email,
        subject: `Cancelled: ${booking.eventTitle}`,
        preheader: `${booking.eventTitle} with ${booking.attendeeName} has been cancelled.`,
        heading: hostHeading,
        body: 'This meeting has been cancelled and the time is available on your schedule again.',
        details: [
          { label: 'Meeting', value: booking.eventTitle },
          { label: 'Was scheduled', value: whenRange(booking.startsAt.toISOString(), booking.endsAt.toISOString(), host.timeZone) },
          { label: 'Guest', value: booking.attendeeName },
          { label: 'Guest email', value: booking.attendeeEmail },
          ...(reason ? [{ label: 'Reason', value: reason }] : [])
        ],
        action: { label: 'See your bookings', url: `${useEnv().schedraUrl}${booking.organizationSlug ? `/t/${booking.organizationSlug}/bookings` : '/bookings'}` },
        footer: 'Schedra has also queued the matching connected-calendar update.'
      }
    }))
  ], executor)
}
