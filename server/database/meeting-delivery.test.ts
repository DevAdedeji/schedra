import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { configureAppTestEnvironment, getTestDatabaseUrl } from '../../test/helpers/database'

const url = getTestDatabaseUrl()

describe.skipIf(!url)('meeting delivery', () => {
  const sql = postgres(url!, { max: 3, onnotice: () => {} })

  beforeEach(async () => {
    configureAppTestEnvironment(url!)
    const { resetEnv } = await import('../utils/env')
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
    const { queueBookingEmails } = await import('../utils/booking-emails')
    const { cancelBookingReminders, processEmailOutbox } = await import('../utils/email-outbox')

    await queueBookingEmails({
      uid: 'meeting-delivery-booking',
      eventTitle: 'Intro call',
      hostName: 'Host Person',
      hostEmail: 'host@example.com',
      hostTimeZone: 'Africa/Lagos',
      attendeeName: 'Guest Person',
      attendeeEmail: 'guest@example.com',
      attendeeTimeZone: 'Europe/London',
      startsAt: '2030-09-07T08:00:00Z',
      endsAt: '2030-09-07T08:30:00Z',
      locationType: 'video_link',
      locationDetails: 'https://meet.example.com/original',
      meetingUrl: 'https://meet.example.com/original',
      reminderMinutes: [1440, 60]
    })

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
    const { findBookingByUid } = await import('../utils/booking-manage')
    const { bookingCalendarFile } = await import('../utils/icalendar')
    const booking = await findBookingByUid('meeting-delivery-booking')
    const calendar = bookingCalendarFile(booking!, 'https://schedra.example')

    expect(calendar).toContain('BEGIN:VCALENDAR\r\n')
    expect(calendar).toContain('DTSTART:20300907T080000Z')
    expect(calendar).toContain('SUMMARY:Intro call with Host Person')
    expect(calendar).toContain('LOCATION:Video call: https://meet.example.com/original')
    expect(calendar).toContain('URL:https://meet.example.com/original')
    expect(calendar).toContain('END:VCALENDAR\r\n')
  })
})
