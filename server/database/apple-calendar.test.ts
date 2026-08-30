import postgres from 'postgres'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureAppTestEnvironment, getTestDatabaseUrl } from '../../test/helpers/database'

const url = getTestDatabaseUrl()

function xml(body: string, status = 207) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/xml; charset=utf-8' }
  })
}

const principal = `<d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop><d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response></d:multistatus>`
const home = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop><c:calendar-home-set><d:href>/123/calendars/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response></d:multistatus>`
const calendars = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/123/calendars/home/</d:href><d:propstat><d:prop><d:displayname>Home</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:current-user-privilege-set><d:privilege><d:read/></d:privilege><d:privilege><d:write-content/></d:privilege></d:current-user-privilege-set><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response></d:multistatus>`

describe.skipIf(!url)('Apple Calendar integration', () => {
  const sql = postgres(url!, { max: 5, onnotice: () => {} })

  async function configure() {
    configureAppTestEnvironment(url!)
    process.env.INTEGRATION_ENCRYPTION_KEY = 'integration-test-key-that-is-at-least-32-characters'
    const { resetEnv } = await import('../config/env')
    resetEnv()
  }

  async function createHost(withSchedule = false) {
    const [host] = await sql<{ id: string }[]>`
      insert into users (email, name, username, email_verified, time_zone)
      values ('host@example.com', 'Host Person', 'host', true, 'Africa/Lagos')
      returning id
    `
    if (!host) throw new Error('Could not create test host.')
    if (!withSchedule) return { hostId: host.id }

    const [schedule] = await sql<{ id: string }[]>`
      insert into schedules (user_id, name, time_zone, is_default)
      values (${host.id}, 'Working hours', 'Africa/Lagos', true)
      returning id
    `
    const [eventType] = await sql<{ id: string }[]>`
      insert into event_types (user_id, schedule_id, slug, title, duration_minutes)
      values (${host.id}, ${schedule!.id}, 'intro', 'Intro call', 30)
      returning id
    `
    await sql`
      insert into availability_rules (schedule_id, weekday, start_time, end_time)
      values (${schedule!.id}, 1, '09:00', '11:00')
    `
    return { hostId: host.id, eventTypeId: eventType!.id }
  }

  function discoveryFetch() {
    return vi.fn()
      .mockResolvedValueOnce(xml(principal))
      .mockResolvedValueOnce(xml(home))
      .mockResolvedValueOnce(xml(calendars))
  }

  async function connect(hostId: string) {
    vi.stubGlobal('fetch', discoveryFetch())
    const { connectAppleCalendar } = await import('../integrations/calendar/caldav')
    await connectAppleCalendar(hostId, {
      username: 'host@icloud.com',
      password: 'abcd-efgh-ijkl-mnop'
    })
  }

  async function createBooking(hostId: string, eventTypeId: string) {
    const [booking] = await sql<{ id: string }[]>`
      insert into bookings (
        event_type_id, host_id, uid, starts_at, ends_at,
        attendee_name, attendee_email, attendee_time_zone
      ) values (
        ${eventTypeId}, ${hostId}, 'apple-calendar-booking',
        '2026-09-07T08:00:00Z', '2026-09-07T08:30:00Z',
        'Guest Person', 'guest@example.com', 'Europe/London'
      ) returning id
    `
    if (!booking) throw new Error('Could not create test booking.')
    return booking.id
  }

  beforeEach(async () => {
    await configure()
    const { clearAppleBusyCache } = await import('../integrations/calendar/caldav')
    clearAppleBusyCache()
    await sql`
      truncate table
        calendar_sync_jobs, booking_calendar_events, calendar_connections,
        email_outbox, api_rate_limits, rate_limits, sessions, accounts,
        verifications, bookings, event_types, date_overrides,
        availability_rules, schedules, users, organizations
      restart identity cascade
    `
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
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

  it('stores the Apple app-specific password encrypted and never returns it in status', async () => {
    const { hostId } = await createHost()
    await connect(hostId)
    const [connection] = await sql<{
      provider: string
      account_label: string
      access_token_encrypted: string
      refresh_token_encrypted: string
      conflict_calendar_ids: string[]
      write_calendar_id: string
    }[]>`
      select provider, account_label, access_token_encrypted, refresh_token_encrypted,
             conflict_calendar_ids, write_calendar_id
      from calendar_connections where user_id = ${hostId}
    `
    expect(connection).toMatchObject({
      provider: 'caldav',
      account_label: 'host@icloud.com',
      conflict_calendar_ids: ['https://caldav.icloud.com/123/calendars/home/'],
      write_calendar_id: 'https://caldav.icloud.com/123/calendars/home/'
    })
    expect(connection?.access_token_encrypted).not.toContain('host@icloud.com')
    expect(connection?.refresh_token_encrypted).not.toContain('abcd-efgh-ijkl-mnop')

    const { appleCalendarConnection } = await import('../integrations/calendar/caldav')
    const status = await appleCalendarConnection(hostId)
    expect(JSON.stringify(status)).not.toContain('abcd-efgh-ijkl-mnop')
  })

  it('removes Apple busy periods from public booking slots', async () => {
    const { hostId } = await createHost(true)
    await connect(hostId)
    const data = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:busy\r\nDTSTART:20260907T090000Z\r\nDTEND:20260907T093000Z\r\nEND:VEVENT\r\nEND:VCALENDAR`
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(xml(
      `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop><c:calendar-data>${data}</c:calendar-data></d:prop></d:propstat></d:response></d:multistatus>`
    )))

    const { findPublicEventType, slotsFor } = await import('../services/booking-page')
    const event = await findPublicEventType('host', 'intro')
    const slots = await slotsFor(event!, '2026-09-07', '2026-09-07', '2026-09-01T00:00:00Z')
    expect(slots.map(slot => slot.start)).toEqual([
      '2026-09-07T08:00:00Z',
      '2026-09-07T08:30:00Z',
      '2026-09-07T09:30:00Z'
    ])
  })

  it('marks the connection for reauthorization when Apple revokes its password', async () => {
    const { hostId } = await createHost()
    await connect(hostId)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    const { listAppleCalendars } = await import('../integrations/calendar/caldav')
    await expect(listAppleCalendars(hostId)).rejects.toMatchObject({
      provider: 'caldav',
      retryable: false
    })
    const [connection] = await sql<{ status: string, last_error: string }[]>`
      select status, last_error from calendar_connections where user_id = ${hostId}
    `
    expect(connection).toMatchObject({
      status: 'needs_reauthorization',
      last_error: 'Apple rejected these credentials. Use your Apple Account email and a current app-specific password.'
    })
  })

  it('creates, updates and deletes Apple events through durable booking sync jobs', async () => {
    const { hostId, eventTypeId } = await createHost(true)
    await connect(hostId)
    const bookingId = await createBooking(hostId, eventTypeId!)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    const { enqueueCalendarSync, processCalendarSyncJobs } = await import('../services/calendar-sync')
    await enqueueCalendarSync(bookingId, 'upsert')
    expect(await processCalendarSyncJobs()).toBe(1)
    const [mapping] = await sql<{ provider: string, calendar_id: string, event_id: string }[]>`
      select provider, calendar_id, event_id from booking_calendar_events where booking_id = ${bookingId}
    `
    expect(mapping).toMatchObject({
      provider: 'caldav',
      calendar_id: 'https://caldav.icloud.com/123/calendars/home/'
    })
    expect(mapping?.event_id).toMatch(/^schedra-[a-f0-9]{40}\.ics$/)

    await sql`
      update bookings set starts_at = '2026-09-07T09:00:00Z', ends_at = '2026-09-07T09:30:00Z'
      where id = ${bookingId}
    `
    await sql`
      update booking_hosts set starts_at = '2026-09-07T09:00:00Z', ends_at = '2026-09-07T09:30:00Z'
      where booking_id = ${bookingId}
    `
    await enqueueCalendarSync(bookingId, 'upsert')
    expect(await processCalendarSyncJobs()).toBe(1)
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(mapping!.event_id)
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain('DTSTART:20260907T090000Z')

    await sql`update bookings set status = 'cancelled' where id = ${bookingId}`
    await enqueueCalendarSync(bookingId, 'delete')
    expect(await processCalendarSyncJobs()).toBe(1)
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe('DELETE')
    expect(await sql`select id from booking_calendar_events where booking_id = ${bookingId}`).toHaveLength(0)
  })
})
