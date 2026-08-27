import postgres from 'postgres'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureAppTestEnvironment, getTestDatabaseUrl } from '../../test/helpers/database'

const url = getTestDatabaseUrl()

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

describe.skipIf(!url)('Microsoft Calendar integration', () => {
  const sql = postgres(url!, { max: 5, onnotice: () => {} })

  async function configure() {
    configureAppTestEnvironment(url!)
    process.env.MICROSOFT_CLIENT_ID = 'microsoft-client-id'
    process.env.MICROSOFT_CLIENT_SECRET = 'microsoft-client-secret'
    process.env.INTEGRATION_ENCRYPTION_KEY = 'integration-test-key-that-is-at-least-32-characters'
    const { resetEnv } = await import('../config/env')
    resetEnv()
  }

  async function createHost(email = 'host@example.com') {
    const [host] = await sql<{ id: string }[]>`
      insert into users (email, name, username, email_verified, time_zone)
      values (${email}, 'Host Person', 'host', true, 'Africa/Lagos')
      returning id
    `
    if (!host) throw new Error('Could not create test host.')
    return host.id
  }

  async function connect(hostId: string) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({
      id: 'microsoft-user-id',
      displayName: 'Host Person',
      mail: 'host@example.com'
    })))
    const { saveMicrosoftConnection } = await import('../integrations/calendar/microsoft')
    await saveMicrosoftConnection(hostId, {
      access_token: 'microsoft-access-token',
      refresh_token: 'microsoft-refresh-token',
      expires_in: 3600,
      scope: 'openid offline_access User.Read Calendars.ReadWrite'
    })
  }

  beforeEach(async () => {
    await configure()
    const { clearMicrosoftBusyCache } = await import('../integrations/calendar/microsoft')
    clearMicrosoftBusyCache()
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

  it('uses the common Microsoft authority and initializes an encrypted primary calendar', async () => {
    const hostId = await createHost()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ id: 'microsoft-user-id', mail: 'host@example.com' }))
      .mockResolvedValueOnce(json({ value: [
        {
          id: 'primary-calendar', name: 'Calendar', isDefaultCalendar: true, canEdit: true,
          canShare: true, hexColor: '#0078d4', allowedOnlineMeetingProviders: ['teamsForBusiness']
        },
        { id: 'shared-calendar', name: 'Shared', canEdit: false, canShare: false }
      ] }))
    vi.stubGlobal('fetch', fetchMock)

    const {
      MICROSOFT_CALENDAR_SCOPES,
      initializeMicrosoftCalendars,
      microsoftCalendarConnection,
      microsoftAuthorizationUrl,
      saveMicrosoftConnection
    } = await import('../integrations/calendar/microsoft')
    const authorization = new URL(microsoftAuthorizationUrl(
      'csrf-state',
      'host@example.com',
      'pkce-challenge'
    ))
    expect(authorization.origin).toBe('https://login.microsoftonline.com')
    expect(authorization.pathname).toBe('/common/oauth2/v2.0/authorize')
    expect(authorization.searchParams.get('state')).toBe('csrf-state')
    expect(authorization.searchParams.get('code_challenge')).toBe('pkce-challenge')
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorization.searchParams.get('scope')?.split(' ')).toEqual(MICROSOFT_CALENDAR_SCOPES)
    expect(authorization.searchParams.get('redirect_uri')).toBe('http://localhost:3002/api/integrations/microsoft-calendar/callback')

    await saveMicrosoftConnection(hostId, {
      access_token: 'plain-access-token',
      refresh_token: 'plain-refresh-token',
      expires_in: 3600
    })
    await initializeMicrosoftCalendars(hostId)

    const { enqueueFutureBookingsForCalendarSync } = await import('../services/calendar-sync')
    await expect(enqueueFutureBookingsForCalendarSync(hostId)).resolves.toBeUndefined()

    const calendarListUrl = String(fetchMock.mock.calls[1]?.[0])
    expect(calendarListUrl).toContain('/me/calendars?')
    expect(calendarListUrl).toContain('canShare')
    expect(calendarListUrl).toContain('allowedOnlineMeetingProviders')
    expect(calendarListUrl).not.toContain('isShared')
    await expect(microsoftCalendarConnection(hostId)).resolves.toMatchObject({ supportsMicrosoftTeams: true })

    const [connection] = await sql<{
      provider: string
      account_label: string
      access_token_encrypted: string
      refresh_token_encrypted: string
      conflict_calendar_ids: string[]
      write_calendar_id: string
    }[]>`select provider, account_label, access_token_encrypted, refresh_token_encrypted,
                 conflict_calendar_ids, write_calendar_id
          from calendar_connections where user_id = ${hostId}`
    expect(connection).toMatchObject({
      provider: 'microsoft',
      account_label: 'host@example.com',
      conflict_calendar_ids: ['primary-calendar'],
      write_calendar_id: 'primary-calendar'
    })
    expect(connection?.access_token_encrypted).not.toContain('plain-access-token')
    expect(connection?.refresh_token_encrypted).not.toContain('plain-refresh-token')
  })

  it('reads recurring calendar-view occurrences and respects Microsoft throttling guidance', async () => {
    const hostId = await createHost()
    await connect(hostId)
    await sql`update calendar_connections set conflict_calendar_ids = '["primary-calendar"]'::jsonb where user_id = ${hostId}`
    const fetchMock = vi.fn().mockResolvedValue(json({ value: [
      {
        id: 'busy-event', showAs: 'busy', isCancelled: false,
        start: { dateTime: '2026-09-07T09:00:00.0000000', timeZone: 'UTC' },
        end: { dateTime: '2026-09-07T09:30:00.0000000', timeZone: 'UTC' }
      },
      {
        id: 'free-event', showAs: 'free', isCancelled: false,
        start: { dateTime: '2026-09-07T10:00:00', timeZone: 'UTC' },
        end: { dateTime: '2026-09-07T10:30:00', timeZone: 'UTC' }
      }
    ] }))
    vi.stubGlobal('fetch', fetchMock)

    const { microsoftBusyTimes } = await import('../integrations/calendar/microsoft')
    await expect(microsoftBusyTimes(hostId, '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z')).resolves.toEqual([
      { start: '2026-09-07T09:00:00.0000000Z', end: '2026-09-07T09:30:00.0000000Z' }
    ])
    const [request, init] = fetchMock.mock.calls[0]!
    expect(String(request)).toContain('/me/calendars/primary-calendar/calendarView?')
    expect(init?.headers).toMatchObject({ prefer: 'outlook.timezone="UTC"' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: {} }, 429, { 'retry-after': '42' })))
    const failure = await microsoftBusyTimes(hostId, '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z').catch(error => error)
    expect(failure).toMatchObject({ provider: 'microsoft', retryable: true, retryAfterMs: 42_000 })
  })

  it('creates, updates and deletes an idempotent Microsoft event', async () => {
    const hostId = await createHost()
    await connect(hostId)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ id: 'event-id' }, 201))
      .mockResolvedValueOnce(json({ id: 'event-id' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const { deleteMicrosoftCalendarEvent, upsertMicrosoftCalendarEvent } = await import('../integrations/calendar/microsoft')
    const input = {
      uid: 'booking-uid', title: 'Intro call', startsAt: new Date('2026-09-07T09:00:00Z'),
      endsAt: new Date('2026-09-07T09:30:00Z'), attendeeName: 'Guest', attendeeEmail: 'guest@example.com',
      additionalGuestEmails: ['second@example.com'], locationType: 'video_link' as const,
      locationDetails: 'https://example.com/room', meetingUrl: null
    }
    await expect(upsertMicrosoftCalendarEvent(hostId, 'primary-calendar', null, input)).resolves.toEqual({ id: 'event-id', meetingUrl: null })
    const createBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(createBody.transactionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(createBody.attendees).toHaveLength(2)
    await expect(upsertMicrosoftCalendarEvent(hostId, 'primary-calendar', 'event-id', input)).resolves.toEqual({ id: 'event-id', meetingUrl: null })
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('PATCH')
    await deleteMicrosoftCalendarEvent(hostId, 'primary-calendar', 'event-id')
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe('DELETE')
  })

  it('creates a Teams-enabled Outlook event and returns its private join link', async () => {
    const hostId = await createHost()
    await connect(hostId)
    const fetchMock = vi.fn().mockResolvedValue(json({
      id: 'teams-event-id',
      onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/test' }
    }, 201))
    vi.stubGlobal('fetch', fetchMock)

    const { upsertMicrosoftCalendarEvent } = await import('../integrations/calendar/microsoft')
    const remote = await upsertMicrosoftCalendarEvent(hostId, 'primary-calendar', null, {
      uid: 'teams-booking',
      title: 'Teams call',
      startsAt: new Date('2026-09-07T09:00:00Z'),
      endsAt: new Date('2026-09-07T09:30:00Z'),
      attendeeName: 'Guest',
      attendeeEmail: 'guest@example.com',
      additionalGuestEmails: [],
      locationType: 'microsoft_teams',
      locationDetails: '',
      meetingUrl: null
    })

    expect(remote).toEqual({
      id: 'teams-event-id',
      meetingUrl: 'https://teams.microsoft.com/l/meetup-join/test'
    })
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body).toMatchObject({
      isOnlineMeeting: true,
      onlineMeetingProvider: 'teamsForBusiness',
      location: { displayName: 'Microsoft Teams' }
    })
  })

  it('makes Microsoft the only booking destination while keeping Google connected for conflicts', async () => {
    const hostId = await createHost()
    await connect(hostId)
    await sql`
      insert into calendar_connections (
        user_id, provider, account_label, access_token_encrypted,
        refresh_token_encrypted, access_token_expires_at, scope,
        conflict_calendar_ids, write_calendar_id
      ) values (
        ${hostId}, 'google', 'host@gmail.com', 'encrypted-access',
        'encrypted-refresh', now() + interval '1 hour', 'calendar',
        '["host@gmail.com"]'::jsonb, 'host@gmail.com'
      )
    `
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ value: [
        { id: 'outlook-primary', name: 'Calendar', isDefaultCalendar: true, canEdit: true }
      ] }))
      .mockResolvedValueOnce(json({ value: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const { updateMicrosoftCalendarSelection } = await import('../integrations/calendar/microsoft')
    await updateMicrosoftCalendarSelection(hostId, ['outlook-primary'], 'outlook-primary')

    const connections = await sql<{ provider: string, write_calendar_id: string | null }[]>`
      select provider, write_calendar_id from calendar_connections where user_id = ${hostId} order by provider
    `
    expect(connections).toEqual([
      { provider: 'google', write_calendar_id: null },
      { provider: 'microsoft', write_calendar_id: 'outlook-primary' }
    ])
  })

  it('does not silently replace an unhealthy provider selected as the booking destination', async () => {
    const hostId = await createHost()
    await sql`
      insert into calendar_connections (
        user_id, provider, account_label, access_token_encrypted,
        refresh_token_encrypted, access_token_expires_at, scope, status,
        conflict_calendar_ids, write_calendar_id
      ) values (
        ${hostId}, 'google', 'host@gmail.com', 'encrypted-access',
        'encrypted-refresh', now() + interval '1 hour', 'calendar', 'needs_reauthorization',
        '["host@gmail.com"]'::jsonb, 'host@gmail.com'
      )
    `
    await connect(hostId)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ value: [
      { id: 'outlook-primary', name: 'Calendar', isDefaultCalendar: true, canEdit: true }
    ] })))

    const { initializeMicrosoftCalendars } = await import('../integrations/calendar/microsoft')
    await initializeMicrosoftCalendars(hostId)

    const connections = await sql<{ provider: string, write_calendar_id: string | null }[]>`
      select provider, write_calendar_id from calendar_connections where user_id = ${hostId} order by provider
    `
    expect(connections).toEqual([
      { provider: 'google', write_calendar_id: 'host@gmail.com' },
      { provider: 'microsoft', write_calendar_id: null }
    ])
  })
})
