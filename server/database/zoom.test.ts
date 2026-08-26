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

describe.skipIf(!url)('Zoom integration', () => {
  const sql = postgres(url!, { max: 5, onnotice: () => {} })

  async function configure() {
    configureAppTestEnvironment(url!)
    process.env.ZOOM_CLIENT_ID = 'zoom-client-id'
    process.env.ZOOM_CLIENT_SECRET = 'zoom-client-secret'
    process.env.ZOOM_WEBHOOK_SECRET = 'zoom-webhook-secret'
    process.env.INTEGRATION_ENCRYPTION_KEY = 'integration-test-key-that-is-at-least-32-characters'
    const { resetEnv } = await import('../config/env')
    resetEnv()
  }

  async function createHostAndBooking() {
    const [host] = await sql<{ id: string }[]>`
      insert into users (email, name, username, email_verified, time_zone)
      values ('zoom-host@example.com', 'Zoom Host', 'zoom-host', true, 'Africa/Lagos')
      returning id
    `
    const [schedule] = await sql<{ id: string }[]>`
      insert into schedules (user_id, name, time_zone, is_default)
      values (${host!.id}, 'Working hours', 'Africa/Lagos', true)
      returning id
    `
    const [eventType] = await sql<{ id: string }[]>`
      insert into event_types (
        user_id, schedule_id, slug, title, description, duration_minutes,
        location_type, location_details
      ) values (
        ${host!.id}, ${schedule!.id}, 'zoom-call', 'Zoom call', 'Project review', 30,
        'zoom', ''
      ) returning id
    `
    const [booking] = await sql<{ id: string }[]>`
      insert into bookings (
        event_type_id, host_id, uid, starts_at, ends_at,
        attendee_name, attendee_email, attendee_time_zone,
        location_type, location_details
      ) values (
        ${eventType!.id}, ${host!.id}, 'zoom-booking-uid',
        '2026-09-07T08:00:00Z', '2026-09-07T08:30:00Z',
        'Guest Person', 'guest@example.com', 'Europe/London', 'zoom', ''
      ) returning id
    `
    return { hostId: host!.id, bookingId: booking!.id }
  }

  async function connect(hostId: string) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({
      id: 'zoom-account-id',
      email: 'zoom-host@example.com'
    })))
    const { saveZoomConnection } = await import('../integrations/video/zoom')
    await saveZoomConnection(hostId, {
      access_token: 'plain-access-token',
      refresh_token: 'plain-refresh-token',
      expires_in: 3600,
      scope: 'meeting:write:meeting'
    })
  }

  beforeEach(async () => {
    await configure()
    await sql`
      truncate table
        calendar_sync_jobs, booking_calendar_events, booking_conference_meetings,
        calendar_connections, video_conference_connections,
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
        calendar_sync_jobs, booking_calendar_events, booking_conference_meetings,
        calendar_connections, video_conference_connections,
        email_outbox, api_rate_limits, rate_limits, sessions, accounts,
        verifications, bookings, event_types, date_overrides,
        availability_rules, schedules, users, organizations
      restart identity cascade
    `
    await sql.end()
  })

  it('builds a state-bound OAuth request and stores credentials encrypted', async () => {
    const { hostId } = await createHostAndBooking()
    const { zoomAuthorizationUrl, saveZoomConnection, zoomConnection } = await import('../integrations/video/zoom')
    const authorization = new URL(zoomAuthorizationUrl('safe-state'))

    expect(authorization.origin).toBe('https://zoom.us')
    expect(authorization.searchParams.get('state')).toBe('safe-state')
    expect(authorization.searchParams.get('redirect_uri')).toBe('http://localhost:3002/api/integrations/zoom/callback')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({
      id: 'zoom-account-id',
      email: 'zoom-host@example.com'
    })))
    await saveZoomConnection(hostId, {
      access_token: 'plain-access-token',
      refresh_token: 'plain-refresh-token',
      expires_in: 3600,
      scope: 'meeting:write:meeting'
    })

    const [stored] = await sql<{
      accessToken: string
      refreshToken: string
      accountLabel: string
    }[]>`
      select access_token_encrypted as "accessToken",
             refresh_token_encrypted as "refreshToken",
             account_label as "accountLabel"
      from video_conference_connections where user_id = ${hostId}
    `
    expect(stored?.accessToken).not.toContain('plain-access-token')
    expect(stored?.refreshToken).not.toContain('plain-refresh-token')
    expect(stored?.accountLabel).toBe('zoom-host@example.com')
    await expect(zoomConnection(hostId)).resolves.toMatchObject({ connected: true, configured: true })
  })

  it('rotates refresh tokens and retries an unauthorized Zoom request once', async () => {
    const { hostId } = await createHostAndBooking()
    await connect(hostId)
    await sql`update video_conference_connections set access_token_expires_at = now() - interval '1 minute' where user_id = ${hostId}`

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const requestUrl = String(input)
      if (requestUrl.startsWith('https://zoom.us/oauth/token')) {
        return json({
          access_token: 'rotated-access-token',
          refresh_token: 'rotated-refresh-token',
          expires_in: 3600,
          scope: 'meeting:write:meeting'
        })
      }
      if (requestUrl.includes('/users/me/meetings?')) return json({ meetings: [] })
      if (requestUrl.endsWith('/users/me/meetings')) {
        return json({ id: 123456789, join_url: 'https://zoom.us/j/123456789?pwd=safe' }, 201)
      }
      return json({ message: 'unexpected request' }, 500)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { upsertZoomMeeting } = await import('../integrations/video/zoom')
    const remote = await upsertZoomMeeting(hostId, null, {
      uid: 'refresh-token-booking',
      title: 'Zoom call',
      description: null,
      startsAt: new Date('2026-09-07T08:00:00Z'),
      endsAt: new Date('2026-09-07T08:30:00Z'),
      attendeeName: 'Guest Person',
      attendeeEmail: 'guest@example.com',
      additionalGuestEmails: [],
      notes: null
    })

    expect(remote).toEqual({ id: '123456789', joinUrl: 'https://zoom.us/j/123456789?pwd=safe' })
    const [stored] = await sql<{ accessToken: string, refreshToken: string }[]>`
      select access_token_encrypted as "accessToken", refresh_token_encrypted as "refreshToken"
      from video_conference_connections where user_id = ${hostId}
    `
    const { decryptCredential } = await import('../integrations/calendar/credential-crypto')
    expect(decryptCredential(stored!.accessToken)).toBe('rotated-access-token')
    expect(decryptCredential(stored!.refreshToken)).toBe('rotated-refresh-token')
  })

  it('creates, updates and deletes the same Zoom meeting through durable booking jobs', async () => {
    const { hostId, bookingId } = await createHostAndBooking()
    await connect(hostId)

    const requests: Array<{ url: string, method: string, body: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = { url: String(input), method: init?.method ?? 'GET', body: String(init?.body ?? '') }
      requests.push(request)
      if (request.url.includes('/users/me/meetings?')) return json({ meetings: [] })
      if (request.url.endsWith('/users/me/meetings') && request.method === 'POST') {
        return json({ id: 987654321, join_url: 'https://zoom.us/j/987654321?pwd=safe' }, 201)
      }
      if (request.url.endsWith('/meetings/987654321') && request.method === 'PATCH') return new Response(null, { status: 204 })
      if (request.url.endsWith('/meetings/987654321') && request.method === 'DELETE') return new Response(null, { status: 204 })
      return json({ message: 'unexpected request' }, 500)
    }))

    const { enqueueCalendarSync, processCalendarSyncJobs } = await import('../services/calendar-sync')
    await enqueueCalendarSync(bookingId, 'upsert')
    expect(await processCalendarSyncJobs()).toBe(1)

    const [created] = await sql<{ meetingUrl: string, meetingId: string }[]>`
      select b.meeting_url as "meetingUrl", m.meeting_id as "meetingId"
      from bookings b inner join booking_conference_meetings m on m.booking_id = b.id
      where b.id = ${bookingId}
    `
    expect(created).toEqual({
      meetingUrl: 'https://zoom.us/j/987654321?pwd=safe',
      meetingId: '987654321'
    })

    await sql`
      update bookings
      set starts_at = '2026-09-07T09:00:00Z', ends_at = '2026-09-07T09:30:00Z'
      where id = ${bookingId}
    `
    await sql`
      update calendar_sync_jobs set status = 'pending', attempts = 0, available_at = now()
      where dedupe_key = ${`upsert:${bookingId}`}
    `
    expect(await processCalendarSyncJobs()).toBe(1)
    expect(requests.some(request => request.method === 'PATCH' && request.body.includes('2026-09-07T09:00:00.000Z'))).toBe(true)

    await sql`update bookings set status = 'cancelled' where id = ${bookingId}`
    await enqueueCalendarSync(bookingId, 'delete')
    expect(await processCalendarSyncJobs()).toBe(1)
    expect(requests.some(request => request.method === 'DELETE' && request.url.endsWith('/meetings/987654321'))).toBe(true)
    expect(await sql`select id from booking_conference_meetings where booking_id = ${bookingId}`).toHaveLength(0)
  })

  it('deauthorization removes credentials and locally held Zoom meeting data', async () => {
    const { hostId, bookingId } = await createHostAndBooking()
    await connect(hostId)
    const [connection] = await sql<{ id: string }[]>`
      select id from video_conference_connections where user_id = ${hostId}
    `
    await sql`
      update bookings
      set meeting_url = 'https://zoom.us/j/123456789?pwd=private'
      where id = ${bookingId}
    `
    await sql`
      insert into booking_conference_meetings (
        booking_id, user_id, connection_id, provider, meeting_id, join_url
      ) values (
        ${bookingId}, ${hostId}, ${connection!.id}, 'zoom', '123456789',
        'https://zoom.us/j/123456789?pwd=private'
      )
    `

    const { deauthorizeZoomUser } = await import('../services/zoom-connection')
    await expect(deauthorizeZoomUser('zoom-account-id')).resolves.toEqual({
      removedConnections: 1,
      removedMeetings: 1
    })

    const [booking] = await sql<{ meetingUrl: string | null }[]>`
      select meeting_url as "meetingUrl" from bookings where id = ${bookingId}
    `
    expect(booking?.meetingUrl).toBeNull()
    expect(await sql`select id from booking_conference_meetings where booking_id = ${bookingId}`).toHaveLength(0)
    expect(await sql`select id from video_conference_connections where user_id = ${hostId}`).toHaveLength(0)

    await expect(deauthorizeZoomUser('zoom-account-id')).resolves.toEqual({
      removedConnections: 0,
      removedMeetings: 0
    })
  })
})
