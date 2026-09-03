import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { configureAppTestEnvironment, getTestDatabaseUrl } from '../../test/helpers/database'

const url = getTestDatabaseUrl()

describe.skipIf(!url)('meeting delivery', () => {
  const sql = postgres(url!, { max: 3, onnotice: () => {} })

  beforeEach(async () => {
    configureAppTestEnvironment(url!)
    const { resetEnv } = await import('../config/env')
    resetEnv()
    await sql`
      truncate table
        calendar_sync_jobs, booking_calendar_events, calendar_connections,
        email_outbox, api_rate_limits, rate_limits, sessions, accounts,
        verifications, bookings, event_types, date_overrides,
        availability_rules, schedules, users, organizations
      restart identity cascade
    `
  })

  afterAll(async () => {
    await sql`
      truncate table
        calendar_sync_jobs, booking_calendar_events, calendar_connections,
        email_outbox, api_rate_limits, rate_limits, sessions, accounts,
        verifications, bookings, event_types, date_overrides,
        availability_rules, schedules, users, organizations
      restart identity cascade
    `
    await sql.end()
  })

  async function bookingFixture() {
    const [host] = await sql<{ id: string }[]>`
      insert into users (email, name, username, email_verified, time_zone)
      values ('host@example.com', 'Host Person', 'host', true, 'Africa/Lagos')
      returning id
    `
    const [eventType] = await sql<{ id: string }[]>`
      insert into event_types (
        user_id, slug, title, duration_minutes, location_type,
        location_details, reminder_minutes
      ) values (
        ${host!.id}, 'intro', 'Intro call', 30, 'video_link',
        'https://meet.example.com/original', '[1440, 60]'::jsonb
      ) returning id
    `
    const [booking] = await sql<{ id: string }[]>`
      insert into bookings (
        event_type_id, host_id, uid, starts_at, ends_at,
        attendee_name, attendee_email, attendee_time_zone,
        location_type, location_details, meeting_url
      ) values (
        ${eventType!.id}, ${host!.id}, 'meeting-delivery-booking',
        '2030-09-07T08:00:00Z', '2030-09-07T08:30:00Z',
        'Guest Person', 'guest@example.com', 'Europe/London',
        'video_link', 'https://meet.example.com/original',
        'https://meet.example.com/original'
      ) returning id
    `
    return { hostId: host!.id, eventTypeId: eventType!.id, bookingId: booking!.id }
  }

  it('keeps meeting details immutable after an event type changes', async () => {
    const { eventTypeId } = await bookingFixture()
    await sql`
      update event_types
      set location_type = 'in_person', location_details = 'A new office'
      where id = ${eventTypeId}
    `

    const [booking] = await sql<{ location_type: string, location_details: string, meeting_url: string }[]>`
      select location_type, location_details, meeting_url
      from bookings where uid = 'meeting-delivery-booking'
    `
    expect(booking).toMatchObject({
      location_type: 'video_link',
      location_details: 'https://meet.example.com/original',
      meeting_url: 'https://meet.example.com/original'
    })
  })

  it('schedules reminder messages and cancels them with the booking', async () => {
    await bookingFixture()
    const { queueBookingEmails } = await import('../services/booking-emails')
    const { cancelBookingReminders, processEmailOutbox } = await import('../services/email-outbox')

    await queueBookingEmails({
      uid: 'meeting-delivery-booking',
      eventTitle: 'Intro call',
      hostName: 'Host Person',
      hostUsername: 'host-person',
      hostEmail: 'host@example.com',
      hostTimeZone: 'Africa/Lagos',
      attendeeName: 'Guest Person',
      attendeeEmail: 'guest@example.com',
      additionalGuestEmails: [],
      attendeeTimeZone: 'Europe/London',
      startsAt: '2030-09-07T08:00:00Z',
      endsAt: '2030-09-07T08:30:00Z',
      locationType: 'video_link',
      locationDetails: 'https://meet.example.com/original',
      meetingUrl: 'https://meet.example.com/original',
      reminderMinutes: [1440, 60]
    })

    const [confirmation] = await sql<{
      preheader: string
      details: Array<{ label: string, value: string }>
    }[]>`
      select preheader, details from email_outbox
      where dedupe_key = 'booking:meeting-delivery-booking:created:guest'
    `
    expect(confirmation?.preheader).toBe('Intro call is confirmed with Host Person.')
    expect(confirmation?.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Meeting', value: 'Intro call' }),
      expect.objectContaining({ label: 'With', value: 'Host Person' })
    ]))

    const reminders = await sql<{ category: string, status: string, available_at: Date }[]>`
      select category, status, available_at from email_outbox
      where category = 'booking_reminder' order by available_at
    `
    expect(reminders).toHaveLength(2)
    expect(reminders.map(row => row.available_at.toISOString())).toEqual([
      '2030-09-06T08:00:00.000Z',
      '2030-09-07T07:00:00.000Z'
    ])

    await cancelBookingReminders('meeting-delivery-booking')
    await sql`update email_outbox set status = 'sent' where category = 'transactional'`
    expect(await processEmailOutbox()).toBe(0)

    const statuses = await sql<{ status: string }[]>`
      select status from email_outbox where category = 'booking_reminder'
    `
    expect(statuses.map(row => row.status)).toEqual(['cancelled', 'cancelled'])
  })

  it('generates a standards-shaped calendar file with the booking snapshot', async () => {
    await bookingFixture()
    const { findBookingByUid } = await import('../repositories/booking')
    const { bookingCalendarFile } = await import('../services/icalendar')
    const booking = await findBookingByUid('meeting-delivery-booking')
    const calendar = bookingCalendarFile(booking!, 'https://schedra.example')

    expect(calendar).toContain('BEGIN:VCALENDAR\r\n')
    expect(calendar).toContain('DTSTART:20300907T080000Z')
    expect(calendar).toContain('SUMMARY:Intro call with Host Person')
    expect(calendar).toContain('LOCATION:Video call: https://meet.example.com/original')
    expect(calendar).toContain('URL:https://meet.example.com/original')
    expect(calendar).toContain('END:VCALENDAR\r\n')
  })

  it('notifies every additional guest without sharing the primary guest management link', async () => {
    await bookingFixture()
    const { queueBookingRequestEmails } = await import('../services/booking-emails')
    await queueBookingRequestEmails({
      uid: 'meeting-delivery-booking',
      eventTitle: 'Intro call',
      hostName: 'Host Person',
      hostUsername: 'host',
      hostEmail: 'host@example.com',
      hostTimeZone: 'Africa/Lagos',
      attendeeName: 'Guest Person',
      attendeeEmail: 'guest@example.com',
      additionalGuestEmails: ['friend@example.com'],
      attendeeTimeZone: 'Europe/London',
      startsAt: '2030-09-07T08:00:00Z',
      endsAt: '2030-09-07T08:30:00Z',
      locationType: 'video_link',
      locationDetails: 'https://meet.example.com/original',
      reminderMinutes: []
    })

    const messages = await sql<{ recipient: string, action_url: string }[]>`
      select recipient, action_url from email_outbox order by recipient
    `
    expect(messages.map(message => message.recipient)).toEqual([
      'friend@example.com',
      'guest@example.com',
      'host@example.com'
    ])
    expect(messages.find(message => message.recipient === 'guest@example.com')?.action_url).toContain('/booking/meeting-delivery-booking')
    expect(messages.find(message => message.recipient === 'friend@example.com')?.action_url).toBe('http://localhost:3002/host')
  })

  it('describes a reschedule clearly, preserves series context and deduplicates every recipient', async () => {
    const { queueBookingRescheduledEmails } = await import('../services/booking-emails')
    const notice = {
      uid: 'rescheduled-booking',
      eventTitle: 'Coaching session',
      hostName: 'Schedra Team',
      hostUsername: 'schedra-team',
      hostEmail: 'organizer@example.com',
      hostTimeZone: 'Africa/Lagos',
      attendeeName: 'Guest Person',
      attendeeEmail: 'guest@example.com',
      additionalGuestEmails: ['friend@example.com'],
      attendeeTimeZone: 'Europe/London',
      startsAt: '2030-09-14T09:00:00Z',
      endsAt: '2030-09-14T09:30:00Z',
      locationType: 'video_link' as const,
      locationDetails: 'https://meet.example.com/updated',
      meetingUrl: 'https://meet.example.com/updated',
      reminderMinutes: [],
      hostRecipients: [
        { name: 'New Host', email: 'new-host@example.com', timeZone: 'Africa/Lagos', isOrganizer: true }
      ],
      publicBookingPath: '/team/schedra-team/coaching-session'
    }
    const details = {
      previousStartsAt: '2030-09-07T08:00:00Z',
      previousEndsAt: '2030-09-07T08:30:00Z',
      requiresConfirmation: false,
      seriesPosition: 2,
      previousHostRecipients: [
        { name: 'Previous Host', email: 'previous-host@example.com', timeZone: 'Europe/Paris', isOrganizer: true }
      ]
    }

    await queueBookingRescheduledEmails(notice, details)
    await queueBookingRescheduledEmails(notice, details)

    const messages = await sql<{
      recipient: string
      subject: string
      heading: string
      details: Array<{ label: string, value: string }>
    }[]>`
      select recipient, subject, heading, details
      from email_outbox order by recipient
    `
    expect(messages).toHaveLength(4)
    expect(messages.find(message => message.recipient === 'guest@example.com')).toMatchObject({
      subject: 'Rescheduled: Coaching session with Schedra Team',
      heading: 'Your meeting has been rescheduled'
    })
    expect(messages.find(message => message.recipient === 'guest@example.com')?.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Recurring meeting', value: 'Meeting 2 in the series' }),
      expect.objectContaining({ label: 'Previous time' }),
      expect.objectContaining({ label: 'New time' })
    ]))
    expect(messages.find(message => message.recipient === 'new-host@example.com')?.subject)
      .toBe('Rescheduled: Coaching session with Guest Person')
    expect(messages.find(message => message.recipient === 'previous-host@example.com')).toMatchObject({
      subject: 'Booking moved: Coaching session with Guest Person',
      heading: 'This booking moved off your schedule'
    })
  })

  it('makes a confirmation-required reschedule an explicit approval request', async () => {
    const { queueBookingRescheduledEmails } = await import('../services/booking-emails')
    await queueBookingRescheduledEmails({
      uid: 'pending-reschedule',
      eventTitle: 'Portfolio review',
      hostName: 'Host Person',
      hostUsername: 'host',
      hostEmail: 'host@example.com',
      hostTimeZone: 'Africa/Lagos',
      attendeeName: 'Guest Person',
      attendeeEmail: 'guest@example.com',
      additionalGuestEmails: [],
      attendeeTimeZone: 'Europe/London',
      startsAt: '2030-09-14T09:00:00Z',
      endsAt: '2030-09-14T09:30:00Z',
      locationType: 'phone',
      locationDetails: '+2348000000000',
      reminderMinutes: []
    }, {
      previousStartsAt: '2030-09-07T08:00:00Z',
      previousEndsAt: '2030-09-07T08:30:00Z',
      requiresConfirmation: true
    })

    const messages = await sql<{ recipient: string, subject: string, action_label: string }[]>`
      select recipient, subject, action_label from email_outbox order by recipient
    `
    expect(messages).toEqual([
      {
        recipient: 'guest@example.com',
        subject: 'Reschedule requested: Portfolio review with Host Person',
        action_label: 'View the request'
      },
      {
        recipient: 'host@example.com',
        subject: 'Approval needed: reschedule for Portfolio review',
        action_label: 'Review requested time'
      }
    ])
  })

  it('suppresses only optional host updates while preserving guest and security email', async () => {
    const { hostId } = await bookingFixture()
    const [guest] = await sql<{ id: string }[]>`
      insert into users (email, name, username, email_verified, time_zone)
      values ('guest@example.com', 'Guest Person', 'guest-person', true, 'Europe/London')
      returning id
    `
    await sql`
      insert into email_notification_preferences (
        user_id, new_booking_emails, reschedule_emails,
        cancellation_emails, approval_request_emails
      ) values
        (${hostId}, false, false, false, false),
        (${guest!.id}, false, false, false, false)
    `

    const { queueBookingEmails, queueCancellationEmails } = await import('../services/booking-emails')
    await queueBookingEmails({
      uid: 'preference-booking',
      eventTitle: 'Intro call',
      hostUserId: hostId,
      hostName: 'Host Person',
      hostUsername: 'host',
      hostEmail: 'host@example.com',
      hostTimeZone: 'Africa/Lagos',
      attendeeName: 'Guest Person',
      attendeeEmail: 'guest@example.com',
      additionalGuestEmails: [],
      attendeeTimeZone: 'Europe/London',
      startsAt: '2030-09-07T08:00:00Z',
      endsAt: '2030-09-07T08:30:00Z',
      locationType: 'video_link',
      locationDetails: 'https://meet.example.com/original',
      reminderMinutes: [60]
    })
    const { findBookingByUid } = await import('../repositories/booking')
    const booking = await findBookingByUid('meeting-delivery-booking')
    await queueCancellationEmails(booking!, 'Plans changed')

    const { queueVerificationEmail } = await import('../services/verification-email')
    await queueVerificationEmail(
      { email: 'host@example.com' },
      'http://localhost:3002/api/auth/verify-email?token=critical-notice'
    )

    const messages = await sql<{ recipient: string, subject: string, category: string }[]>`
      select recipient, subject, category from email_outbox order by recipient, subject
    `
    expect(messages.filter(message => message.recipient === 'guest@example.com').map(message => message.subject))
      .toEqual([
        'Cancelled: Intro call with Host Person',
        'Confirmed: Intro call with Host Person',
        'Reminder: Intro call is in 1 hour'
      ])
    expect(messages.filter(message => message.recipient === 'host@example.com')).toEqual([
      {
        recipient: 'host@example.com',
        subject: 'Confirm your email for Schedra',
        category: 'transactional'
      }
    ])
  })

  it('returns enabled defaults and persists all account notification choices', async () => {
    const { hostId } = await bookingFixture()
    const { emailPreferencesForUser, saveEmailPreferences } = await import('../services/email-notification-preferences')
    await expect(emailPreferencesForUser(hostId)).resolves.toEqual({
      newBookingEmails: true,
      rescheduleEmails: true,
      cancellationEmails: true,
      approvalRequestEmails: true
    })
    const disabled = {
      newBookingEmails: false,
      rescheduleEmails: false,
      cancellationEmails: false,
      approvalRequestEmails: false
    }
    await expect(saveEmailPreferences(hostId, disabled)).resolves.toEqual(disabled)
    await expect(emailPreferencesForUser(hostId)).resolves.toEqual(disabled)
  })
})
