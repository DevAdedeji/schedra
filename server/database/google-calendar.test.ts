import postgres from 'postgres'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureAppTestEnvironment, getTestDatabaseUrl } from '../../test/helpers/database'

const url = getTestDatabaseUrl()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe.skipIf(!url)('Google Calendar integration', () => {
  const sql = postgres(url!, { max: 5, onnotice: () => {} })

  async function configure() {
    configureAppTestEnvironment(url!)
    process.env.GOOGLE_CLIENT_ID = 'google-client-id'
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret'
    process.env.INTEGRATION_ENCRYPTION_KEY = 'integration-test-key-that-is-at-least-32-characters'
    const { resetEnv } = await import('../utils/env')
    resetEnv()
  }

  async function createHost(options: { withSchedule?: boolean } = {}) {
    const [host] = await sql<{ id: string }[]>`
      insert into users (email, name, username, email_verified, time_zone)
      values ('host@example.com', 'Host Person', 'host', true, 'Africa/Lagos')
      returning id
    `
    if (!host) throw new Error('Could not create test host.')

    if (!options.withSchedule) return { hostId: host.id }

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
    return { hostId: host.id, scheduleId: schedule!.id, eventTypeId: eventType!.id }
  }

  async function connect(hostId: string, expiresIn = 3600) {
    const { saveGoogleConnection } = await import('../utils/google-calendar')
    await saveGoogleConnection(hostId, {
      access_token: 'plain-access-token',
      refresh_token: 'plain-refresh-token',
      expires_in: expiresIn,
      scope: 'calendar scopes'
    })
  }

  async function chooseCalendars(hostId: string) {
    await sql`
      update calendar_connections
      set account_label = 'primary@example.com',
          conflict_calendar_ids = '["primary@example.com"]'::jsonb,
          write_calendar_id = 'primary@example.com'
      where user_id = ${hostId}
    `
  }

  async function createBooking(hostId: string, eventTypeId: string, uid: string, start = '2026-09-07T08:00:00Z') {
    const startsAt = new Date(start)
    const endsAt = new Date(startsAt.getTime() + 30 * 60_000)
    const [booking] = await sql<{ id: string }[]>`
      insert into bookings (
        event_type_id, host_id, uid, starts_at, ends_at,
        attendee_name, attendee_email, attendee_time_zone
      ) values (
        ${eventTypeId}, ${hostId}, ${uid}, ${startsAt.toISOString()}, ${endsAt.toISOString()},
        'Guest Person', 'guest@example.com', 'Europe/London'
      ) returning id
    `
    if (!booking) throw new Error('Could not create test booking.')
    return booking.id
  }

  beforeEach(async () => {
    await configure()
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

  it('builds a safe OAuth request and initializes an encrypted connection', async () => {
    const { hostId } = await createHost()
    const fetchMock = vi.fn().mockResolvedValue(json({
      items: [
        {
          id: 'primary@example.com',
          summary: 'Primary',
          primary: true,
          accessRole: 'owner',
          backgroundColor: '#4285f4'
        },
        {
          id: 'readonly@example.com',
          summary: 'Shared',
          accessRole: 'reader'
        }
      ]
    }))
    vi.stubGlobal('fetch', fetchMock)

    const {
      GOOGLE_CALENDAR_SCOPES,
      googleAuthorizationUrl,
      initializeGoogleCalendars
    } = await import('../utils/google-calendar')
    const state = 'csrf-state-value'
    const authorization = new URL(googleAuthorizationUrl(state, 'host@example.com'))

    expect(authorization.origin).toBe('https://accounts.google.com')
    expect(authorization.searchParams.get('state')).toBe(state)
    expect(authorization.searchParams.get('access_type')).toBe('offline')
    expect(authorization.searchParams.get('prompt')).toBe('consent')
    expect(authorization.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3002/api/integrations/google-calendar/callback'
    )
    expect(authorization.searchParams.get('scope')?.split(' ')).toEqual(GOOGLE_CALENDAR_SCOPES)

    await connect(hostId)
    await initializeGoogleCalendars(hostId)

    const [connection] = await sql<{
      access_token_encrypted: string
      refresh_token_encrypted: string
      account_label: string
      conflict_calendar_ids: string[]
      write_calendar_id: string
    }[]>`
      select access_token_encrypted, refresh_token_encrypted, account_label,
             conflict_calendar_ids, write_calendar_id
      from calendar_connections where user_id = ${hostId}
    `

    expect(connection?.access_token_encrypted).not.toContain('plain-access-token')
    expect(connection?.refresh_token_encrypted).not.toContain('plain-refresh-token')
    expect(connection?.account_label).toBe('primary@example.com')
    expect(connection?.conflict_calendar_ids).toEqual(['primary@example.com'])
    expect(connection?.write_calendar_id).toBe('primary@example.com')
  })

  it('refreshes an expired access token before calling Google', async () => {
    const { hostId } = await createHost()
    await connect(hostId)
    await sql`update calendar_connections set access_token_expires_at = now() - interval '1 minute' where user_id = ${hostId}`

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ access_token: 'refreshed-access-token', expires_in: 3600 }))
      .mockResolvedValueOnce(json({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const { listGoogleCalendars } = await import('../utils/google-calendar')
    const { decryptCredential } = await import('../utils/credential-crypto')
    await listGoogleCalendars(hostId)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://oauth2.googleapis.com/token')
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain('refresh_token=plain-refresh-token')
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      authorization: 'Bearer refreshed-access-token'
    })

    const [connection] = await sql<{ access_token_encrypted: string, status: string }[]>`
      select access_token_encrypted, status from calendar_connections where user_id = ${hostId}
    `
    expect(decryptCredential(connection!.access_token_encrypted)).toBe('refreshed-access-token')
    expect(connection?.status).toBe('active')
  })

  it('requires reauthorization when Google rejects the refresh token', async () => {
    const { hostId } = await createHost()
    await connect(hostId)
    await sql`update calendar_connections set access_token_expires_at = now() - interval '1 minute' where user_id = ${hostId}`
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'invalid_grant' }, 400)))

    const { CalendarUnavailableError, listGoogleCalendars } = await import('../utils/google-calendar')
    await expect(listGoogleCalendars(hostId)).rejects.toBeInstanceOf(CalendarUnavailableError)

    const [connection] = await sql<{ status: string, last_error: string }[]>`
      select status, last_error from calendar_connections where user_id = ${hostId}
    `
    expect(connection).toMatchObject({
      status: 'needs_reauthorization',
      last_error: 'Google authorization expired.'
    })
  })

  it('removes Google busy periods from the public booking slots', async () => {
    const { hostId } = await createHost({ withSchedule: true })
    await connect(hostId)
    await chooseCalendars(hostId)
    const fetchMock = vi.fn().mockResolvedValue(json({
      calendars: {
        'primary@example.com': {
          busy: [{ start: '2026-09-07T09:00:00Z', end: '2026-09-07T09:30:00Z' }]
        }
      }
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { findPublicEventType, slotsFor } = await import('../utils/booking-page')
    const event = await findPublicEventType('host', 'intro')
    const slots = await slotsFor(event!, '2026-09-07', '2026-09-07', '2026-09-01T00:00:00Z')

    expect(slots.map(slot => slot.start)).toEqual([
      '2026-09-07T08:00:00Z',
      '2026-09-07T08:30:00Z',
      '2026-09-07T09:30:00Z'
    ])
    const [requestUrl, requestInit] = fetchMock.mock.calls[0]!
    expect(String(requestUrl)).toContain('/calendar/v3/freeBusy')
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      items: [{ id: 'primary@example.com' }]
    })
  })

  it('creates, reschedules and cancels calendar events through durable jobs', async () => {
    const { hostId, eventTypeId } = await createHost({ withSchedule: true })
    await connect(hostId)
    await chooseCalendars(hostId)
    const originalId = await createBooking(hostId, eventTypeId!, 'original-booking')

    const fetchMock = vi.fn(async (request: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method === 'DELETE') return new Response(null, { status: 204 })
      if (method === 'PATCH') return json({}, 404)
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body)) as { id: string }
        return json({ id: body.id })
      }
      throw new Error(`Unexpected Google request: ${method} ${String(request)}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { enqueueCalendarSync, processCalendarSyncJobs } = await import('../utils/calendar-sync')
    await enqueueCalendarSync(originalId, 'upsert')
    expect(await processCalendarSyncJobs()).toBe(1)

    const [originalMapping] = await sql<{ event_id: string }[]>`
      select event_id from booking_calendar_events where booking_id = ${originalId}
    `
    expect(originalMapping?.event_id).toMatch(/^schedra[a-f0-9]{64}$/)

    await sql`
      update bookings
      set status = 'cancelled', cancellation_reason = 'Moved to another time'
      where id = ${originalId}
    `
    const movedId = await createBooking(
      hostId,
      eventTypeId!,
      'moved-booking',
      '2026-09-07T09:30:00Z'
    )
    await sql`update bookings set rescheduled_from_id = ${originalId} where id = ${movedId}`
    await enqueueCalendarSync(originalId, 'delete')
    await enqueueCalendarSync(movedId, 'upsert')

    expect(await processCalendarSyncJobs()).toBe(2)
    const mappings = await sql<{ booking_id: string }[]>`
      select booking_id from booking_calendar_events order by booking_id
    `
    expect(mappings.map(row => row.booking_id)).toEqual([movedId])

    await sql`update bookings set status = 'cancelled' where id = ${movedId}`
    await enqueueCalendarSync(movedId, 'delete')
    expect(await processCalendarSyncJobs()).toBe(1)
    expect(await sql`select id from booking_calendar_events`).toHaveLength(0)

    const methods = fetchMock.mock.calls.map(call => call[1]?.method)
    expect(methods.filter(method => method === 'POST')).toHaveLength(2)
    expect(methods.filter(method => method === 'DELETE')).toHaveLength(2)
  })

  it('backs off transient failures and stops after the eighth attempt', async () => {
    const { hostId, eventTypeId } = await createHost({ withSchedule: true })
    await connect(hostId)
    await chooseCalendars(hostId)
    const bookingId = await createBooking(hostId, eventTypeId!, 'retry-booking')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'temporary' }, 503)))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { enqueueCalendarSync, processCalendarSyncJobs } = await import('../utils/calendar-sync')
    await enqueueCalendarSync(bookingId, 'upsert')
    expect(await processCalendarSyncJobs()).toBe(1)

    let [job] = await sql<{
      status: string
      attempts: number
      available_at: Date
      last_error: string
    }[]>`select status, attempts, available_at, last_error from calendar_sync_jobs where booking_id = ${bookingId}`
    expect(job?.status).toBe('pending')
    expect(job?.attempts).toBe(1)
    expect(job?.available_at.getTime()).toBeGreaterThan(Date.now())
    expect(job?.last_error).toContain('Google Calendar request failed (503)')

    await sql`
      update calendar_sync_jobs
      set status = 'pending', attempts = 7, available_at = now(), locked_at = null
      where booking_id = ${bookingId}
    `
    expect(await processCalendarSyncJobs()).toBe(1)

    ;[job] = await sql<{
      status: string
      attempts: number
      available_at: Date
      last_error: string
    }[]>`select status, attempts, available_at, last_error from calendar_sync_jobs where booking_id = ${bookingId}`
    expect(job?.status).toBe('failed')
    expect(job?.attempts).toBe(8)
  })

  it('validates calendar choices and disconnects locally if revocation fails', async () => {
    const { hostId } = await createHost()
    await connect(hostId)
    const calendars = {
      items: [
        { id: 'primary@example.com', summary: 'Primary', primary: true, accessRole: 'owner' },
        { id: 'read-only@example.com', summary: 'Read only', accessRole: 'reader' }
      ]
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(calendars))
      .mockResolvedValueOnce(json(calendars))
      .mockRejectedValueOnce(new Error('Google is unavailable'))
    vi.stubGlobal('fetch', fetchMock)

    const {
      CalendarSelectionError,
      disconnectGoogleCalendar,
      updateGoogleCalendarSelection
    } = await import('../utils/google-calendar')

    await expect(updateGoogleCalendarSelection(
      hostId,
      ['primary@example.com'],
      'read-only@example.com'
    )).rejects.toBeInstanceOf(CalendarSelectionError)

    await updateGoogleCalendarSelection(
      hostId,
      ['primary@example.com', 'read-only@example.com'],
      'primary@example.com'
    )
    await disconnectGoogleCalendar(hostId)

    expect(await sql`select id from calendar_connections where user_id = ${hostId}`).toHaveLength(0)
  })
})
