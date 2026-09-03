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
    const { resetEnv } = await import('../config/env')
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
    const { saveGoogleConnection } = await import('../integrations/calendar/google')
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
    const { clearGoogleBusyCache } = await import('../integrations/calendar/google')
    clearGoogleBusyCache()
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
    } = await import('../integrations/calendar/google')
    const state = 'csrf-state-value'
    const authorization = new URL(googleAuthorizationUrl(state, 'host@example.com', 'pkce-challenge'))

    expect(authorization.origin).toBe('https://accounts.google.com')
    expect(authorization.searchParams.get('state')).toBe(state)
    expect(authorization.searchParams.get('access_type')).toBe('offline')
    expect(authorization.searchParams.get('prompt')).toBe('consent')
    expect(authorization.searchParams.get('code_challenge')).toBe('pkce-challenge')
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
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

    const { listGoogleCalendars } = await import('../integrations/calendar/google')
    const { decryptCredential } = await import('../integrations/calendar/credential-crypto')
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

    const { CalendarUnavailableError, listGoogleCalendars } = await import('../integrations/calendar/google')
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

    const { findPublicEventType, slotsFor } = await import('../services/booking-page')
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

  it('keeps healthy conflict checks when Google rejects a subscribed calendar', async () => {
    const { hostId } = await createHost()
    await connect(hostId)
    await sql`
      update calendar_connections
      set conflict_calendar_ids = '["primary@example.com", "holidays@example.com"]'::jsonb
      where user_id = ${hostId}
    `
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({
      calendars: {
        'primary@example.com': {
          busy: [{ start: '2026-09-07T09:00:00Z', end: '2026-09-07T09:30:00Z' }]
        },
        'holidays@example.com': {
          errors: [{ domain: 'global', reason: 'notFound' }]
        }
      }
    })))

    const { googleBusyTimes } = await import('../integrations/calendar/google')
    const busy = await googleBusyTimes(hostId, '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z')

    expect(busy).toEqual([
      { start: '2026-09-07T09:00:00Z', end: '2026-09-07T09:30:00Z' }
    ])
    const [connection] = await sql<{ conflict_calendar_ids: string[], last_error: string }[]>`
      select conflict_calendar_ids, last_error
      from calendar_connections
      where user_id = ${hostId}
    `
    expect(connection?.conflict_calendar_ids).toEqual(['primary@example.com'])
    expect(connection?.last_error).toContain('1 selected calendar was removed')
  })

  it('rejects conflict calendars that Google cannot check before saving preferences', async () => {
    const { hostId } = await createHost()
    await connect(hostId)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({
        items: [
          { id: 'primary@example.com', summary: 'Primary', primary: true, accessRole: 'owner' },
          { id: 'holidays@example.com', summary: 'Holidays', accessRole: 'reader' }
        ]
      }))
      .mockResolvedValueOnce(json({
        calendars: {
          'primary@example.com': { busy: [] },
          'holidays@example.com': { errors: [{ domain: 'global', reason: 'notFound' }] }
        }
      }))
    vi.stubGlobal('fetch', fetchMock)

    const { CalendarSelectionError, updateGoogleCalendarSelection } = await import('../integrations/calendar/google')
    const failure = await updateGoogleCalendarSelection(
      hostId,
      ['primary@example.com', 'holidays@example.com'],
      'primary@example.com'
    ).catch(error => error)
    expect(failure).toBeInstanceOf(CalendarSelectionError)
    expect((failure as Error).message).toContain('Google cannot check busy times on Holidays')
  })

  it('deduplicates overlapping Google free-busy checks briefly', async () => {
    const { hostId } = await createHost()
    await connect(hostId)
    await chooseCalendars(hostId)
    const fetchMock = vi.fn().mockResolvedValue(json({
      calendars: {
        'primary@example.com': {
          busy: [
            { start: '2026-09-07T09:00:00Z', end: '2026-09-07T09:30:00Z' },
            { start: '2026-09-10T09:00:00Z', end: '2026-09-10T09:30:00Z' }
          ]
        }
      }
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { googleBusyTimes } = await import('../integrations/calendar/google')
    await googleBusyTimes(hostId, '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z')
    const narrowed = await googleBusyTimes(hostId, '2026-09-07T00:00:00Z', '2026-09-08T00:00:00Z')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(narrowed).toEqual([
      { start: '2026-09-07T09:00:00Z', end: '2026-09-07T09:30:00Z' }
    ])
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

    const { enqueueCalendarSync, processCalendarSyncJobs } = await import('../services/calendar-sync')
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

  it('creates one private Google Meet per booking and stores its join link', async () => {
    const { hostId, eventTypeId } = await createHost({ withSchedule: true })
    await connect(hostId)
    await chooseCalendars(hostId)
    const bookingId = await createBooking(hostId, eventTypeId!, 'google-meet-booking')
    await sql`
      update bookings
      set location_type = 'google_meet',
          location_details = '',
          meeting_url = null
      where id = ${bookingId}
    `

    const fetchMock = vi.fn(async (_request: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'PATCH') return json({}, 404)
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { id: string }
        return json({ id: body.id, hangoutLink: 'https://meet.google.com/abc-defg-hij' })
      }
      if (init?.method === 'DELETE') return new Response(null, { status: 204 })
      throw new Error(`Unexpected Google request: ${init?.method}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { enqueueCalendarSync, processCalendarSyncJobs } = await import('../services/calendar-sync')
    await enqueueCalendarSync(bookingId, 'upsert')
    expect(await processCalendarSyncJobs()).toBe(1)

    const post = fetchMock.mock.calls.find(call => call[1]?.method === 'POST')!
    const requestUrl = new URL(String(post[0]))
    const requestBody = JSON.parse(String(post[1]?.body))
    expect(requestUrl.searchParams.get('sendUpdates')).toBe('all')
    expect(requestUrl.searchParams.get('conferenceDataVersion')).toBe('1')
    expect(requestBody.conferenceData.createRequest).toMatchObject({
      conferenceSolutionKey: { type: 'hangoutsMeet' }
    })
    expect(requestBody.conferenceData.createRequest.requestId).toMatch(/^schedra-[a-f0-9]{32}$/)

    const [booking] = await sql<{ meeting_url: string }[]>`
      select meeting_url from bookings where id = ${bookingId}
    `
    expect(booking?.meeting_url).toBe('https://meet.google.com/abc-defg-hij')

    await sql`update bookings set status = 'cancelled' where id = ${bookingId}`
    await enqueueCalendarSync(bookingId, 'delete')
    expect(await processCalendarSyncJobs()).toBe(1)
    const deletion = fetchMock.mock.calls.find(call => call[1]?.method === 'DELETE')!
    expect(new URL(String(deletion[0])).searchParams.get('sendUpdates')).toBe('all')
  })

  it('writes one calendar event per assigned host without duplicating guest invitations', async () => {
    const { hostId, eventTypeId } = await createHost({ withSchedule: true })
    const [coHost] = await sql<{ id: string }[]>`
      insert into users (email, name, username, email_verified, time_zone)
      values ('cohost@example.com', 'Co Host', 'cohost', true, 'Europe/London')
      returning id
    `
    await connect(hostId)
    await connect(coHost!.id)
    await chooseCalendars(hostId)
    await chooseCalendars(coHost!.id)

    const bookingId = await createBooking(hostId, eventTypeId!, 'collective-calendar-booking')
    const [booking] = await sql<{ starts_at: Date, ends_at: Date }[]>`
      select starts_at, ends_at from bookings where id = ${bookingId}
    `
    await sql`
      insert into booking_hosts (booking_id, user_id, starts_at, ends_at)
      values (${bookingId}, ${coHost!.id}, ${booking!.starts_at}, ${booking!.ends_at})
    `

    const fetchMock = vi.fn(async (_request: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'PATCH') return json({}, 404)
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { id: string }
        return json({ id: body.id })
      }
      throw new Error(`Unexpected Google request: ${init?.method}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { enqueueCalendarSync, processCalendarSyncJobs } = await import('../services/calendar-sync')
    await enqueueCalendarSync(bookingId, 'upsert')
    expect(await processCalendarSyncJobs()).toBe(1)

    const mappings = await sql<{ user_id: string, event_id: string }[]>`
      select user_id, event_id from booking_calendar_events
      where booking_id = ${bookingId} order by user_id
    `
    expect(mappings).toHaveLength(2)
    expect(new Set(mappings.map(row => row.user_id))).toEqual(new Set([hostId, coHost!.id]))
    expect(new Set(mappings.map(row => row.event_id)).size).toBe(2)

    const posts = fetchMock.mock.calls.filter(call => call[1]?.method === 'POST')
    expect(posts).toHaveLength(2)
    const updates = posts.map(call => new URL(String(call[0])).searchParams.get('sendUpdates'))
    expect(updates.sort()).toEqual(['all', 'none'])
    const bodies = posts.map(call => JSON.parse(String(call[1]?.body)) as { attendees: unknown[] })
    expect(bodies.filter(body => body.attendees.length > 0)).toHaveLength(1)
    expect(bodies.filter(body => body.attendees.length === 0)).toHaveLength(1)
  })

  it('requires a writable Google calendar for every active Google Meet host', async () => {
    const { hostId } = await createHost()
    const [coHost] = await sql<{ id: string }[]>`
      insert into users (email, name, username, email_verified, time_zone)
      values ('cohost@example.com', 'Co Host', 'cohost', true, 'Europe/London')
      returning id
    `
    const { requireTeamLocationIntegrations } = await import('../services/event-location')
    vi.stubGlobal('createError', (input: { statusCode: number, statusMessage: string }) =>
      Object.assign(new Error(input.statusMessage), input))

    await connect(hostId)
    await expect(requireTeamLocationIntegrations([hostId], 'google_meet')).rejects.toThrow(
      'Every active host must connect Google Calendar'
    )

    await chooseCalendars(hostId)
    await expect(requireTeamLocationIntegrations([hostId, coHost!.id], 'google_meet')).rejects.toThrow(
      'Every active host must connect Google Calendar'
    )

    await connect(coHost!.id)
    await chooseCalendars(coHost!.id)
    await expect(requireTeamLocationIntegrations([hostId, coHost!.id], 'google_meet')).resolves.toBeUndefined()

    // Non-Google locations never require a calendar connection.
    await expect(requireTeamLocationIntegrations([crypto.randomUUID()], 'phone')).resolves.toBeUndefined()
  })

  it('backs off transient failures and stops after the eighth attempt', async () => {
    const { hostId, eventTypeId } = await createHost({ withSchedule: true })
    await connect(hostId)
    await chooseCalendars(hostId)
    const bookingId = await createBooking(hostId, eventTypeId!, 'retry-booking')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'temporary' }, 503)))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { enqueueCalendarSync, processCalendarSyncJobs } = await import('../services/calendar-sync')
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

  it('reconciles stale remote events without duplicating jobs or mappings', async () => {
    const { hostId, eventTypeId } = await createHost({ withSchedule: true })
    await connect(hostId)
    await chooseCalendars(hostId)
    const future = new Date(Date.now() + 7 * 24 * 60 * 60_000)
    const bookingId = await createBooking(hostId, eventTypeId!, 'reconciliation-booking', future.toISOString())
    const fetchMock = vi.fn(async (_request: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'PATCH') return json({}, 404)
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { id: string }
        return json({ id: body.id }, 201)
      }
      throw new Error(`Unexpected Google request: ${init?.method}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const {
      enqueueCalendarReconciliation,
      enqueueCalendarSync,
      processCalendarSyncJobs
    } = await import('../services/calendar-sync')
    await enqueueCalendarSync(bookingId, 'upsert')
    expect(await processCalendarSyncJobs()).toBe(1)
    await sql`
      update booking_calendar_events
      set synced_at = now() - interval '13 hours'
      where booking_id = ${bookingId}
    `

    expect(await enqueueCalendarReconciliation()).toBe(1)
    expect(await enqueueCalendarReconciliation()).toBe(0)
    expect(await processCalendarSyncJobs()).toBe(1)

    const [counts] = await sql<{ jobs: number, mappings: number }[]>`
      select
        (select count(*)::int from calendar_sync_jobs where booking_id = ${bookingId}) as jobs,
        (select count(*)::int from booking_calendar_events where booking_id = ${bookingId}) as mappings
    `
    expect(counts).toEqual({ jobs: 1, mappings: 1 })
    expect(fetchMock.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(2)
  })

  it('keeps provider timeouts retryable and records which calendar failed', async () => {
    const { hostId, eventTypeId } = await createHost({ withSchedule: true })
    await connect(hostId)
    await chooseCalendars(hostId)
    const future = new Date(Date.now() + 7 * 24 * 60 * 60_000)
    const bookingId = await createBooking(hostId, eventTypeId!, 'timeout-reconciliation', future.toISOString())
    await sql`
      insert into booking_calendar_events (
        booking_id, user_id, provider, calendar_id, event_id, synced_at
      ) values (
        ${bookingId}, ${hostId}, 'google', 'primary@example.com', 'remote-event',
        now() - interval '13 hours'
      )
    `
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Timed out', 'TimeoutError')))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { enqueueCalendarReconciliation, processCalendarSyncJobs } = await import('../services/calendar-sync')
    expect(await enqueueCalendarReconciliation()).toBe(1)
    expect(await processCalendarSyncJobs()).toBe(1)

    const [job] = await sql<{ status: string, attempts: number, failure_provider: string, last_error: string }[]>`
      select status, attempts, failure_provider, last_error
      from calendar_sync_jobs where booking_id = ${bookingId}
    `
    expect(job).toMatchObject({
      status: 'pending',
      attempts: 1,
      failure_provider: 'google',
      last_error: 'Google Calendar is temporarily unavailable.'
    })
  })

  it('stops reconciliation and requests reconnection when provider access is revoked', async () => {
    const { hostId, eventTypeId } = await createHost({ withSchedule: true })
    await connect(hostId)
    await chooseCalendars(hostId)
    const future = new Date(Date.now() + 7 * 24 * 60 * 60_000)
    const bookingId = await createBooking(hostId, eventTypeId!, 'revoked-reconciliation', future.toISOString())
    await sql`
      update calendar_connections
      set access_token_expires_at = now() - interval '1 minute'
      where user_id = ${hostId}
    `
    await sql`
      insert into booking_calendar_events (
        booking_id, user_id, provider, calendar_id, event_id, synced_at
      ) values (
        ${bookingId}, ${hostId}, 'google', 'primary@example.com', 'remote-event',
        now() - interval '13 hours'
      )
    `
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'invalid_grant' }, 400)))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { enqueueCalendarReconciliation, processCalendarSyncJobs } = await import('../services/calendar-sync')
    expect(await enqueueCalendarReconciliation()).toBe(1)
    expect(await processCalendarSyncJobs()).toBe(1)

    const [[connection], [job]] = await Promise.all([
      sql<{ status: string, last_error: string }[]>`
        select status, last_error from calendar_connections where user_id = ${hostId}
      `,
      sql<{ status: string, failure_provider: string }[]>`
        select status, failure_provider from calendar_sync_jobs where booking_id = ${bookingId}
      `
    ])
    expect(connection).toMatchObject({
      status: 'needs_reauthorization',
      last_error: 'Google authorization expired.'
    })
    expect(job).toMatchObject({ status: 'failed', failure_provider: 'google' })
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
      .mockResolvedValueOnce(json({
        calendars: {
          'primary@example.com': { busy: [] },
          'read-only@example.com': { busy: [] }
        }
      }))
      .mockRejectedValueOnce(new Error('Google is unavailable'))
    vi.stubGlobal('fetch', fetchMock)

    const {
      CalendarSelectionError,
      disconnectGoogleCalendar,
      updateGoogleCalendarSelection
    } = await import('../integrations/calendar/google')

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
