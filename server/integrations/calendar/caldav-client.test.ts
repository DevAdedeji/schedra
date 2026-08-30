import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appleBusyTimes,
  appleEventId,
  CalDavClientError,
  deleteAppleCalendarEvent,
  discoverAppleCalendars,
  upsertAppleCalendarEvent
} from './caldav-client'

const credentials = { username: 'host@icloud.com', password: 'abcd-efgh-ijkl-mnop' }

function xml(body: string, status = 207, headers: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/xml; charset=utf-8', ...headers }
  })
}

const principalResponse = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:"><d:response><d:href>/</d:href><d:propstat><d:prop>
<d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal>
</d:prop></d:propstat></d:response></d:multistatus>`

const homeResponse = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop>
<c:calendar-home-set><d:href>/123/calendars/</d:href></c:calendar-home-set>
</d:prop></d:propstat></d:response></d:multistatus>`

const calendarsResponse = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">
  <d:response><d:href>/123/calendars/home/</d:href><d:propstat><d:prop>
    <d:displayname>Home &amp; work</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
    <d:current-user-privilege-set><d:privilege><d:read/></d:privilege><d:privilege><d:write-content/></d:privilege></d:current-user-privilege-set>
    <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set><a:calendar-color>#ff9500ff</a:calendar-color>
  </d:prop></d:propstat></d:response>
  <d:response><d:href>/123/calendars/holidays/</d:href><d:propstat><d:prop>
    <d:displayname>Holidays</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
    <d:current-user-privilege-set><d:privilege><d:read/></d:privilege></d:current-user-privilege-set>
    <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>
  </d:prop></d:propstat></d:response>
</d:multistatus>`

function bookingInput() {
  return {
    uid: 'booking-uid',
    title: 'Planning call',
    description: 'Quarterly planning',
    startsAt: new Date('2026-09-07T09:00:00Z'),
    endsAt: new Date('2026-09-07T09:30:00Z'),
    attendeeName: 'Guest Person',
    attendeeEmail: 'guest@example.com',
    additionalGuestEmails: [],
    locationType: 'video_link' as const,
    locationDetails: 'https://example.com/room',
    meetingUrl: 'https://example.com/room'
  }
}

describe('Apple CalDAV client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('discovers writable and read-only Apple calendars without exposing credentials in URLs', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(xml(principalResponse))
      .mockResolvedValueOnce(xml(homeResponse))
      .mockResolvedValueOnce(xml(calendarsResponse))
    vi.stubGlobal('fetch', fetchMock)

    await expect(discoverAppleCalendars(credentials)).resolves.toEqual([
      {
        id: 'https://caldav.icloud.com/123/calendars/home/',
        summary: 'Home & work',
        primary: true,
        accessRole: 'writer',
        backgroundColor: '#ff9500ff'
      },
      {
        id: 'https://caldav.icloud.com/123/calendars/holidays/',
        summary: 'Holidays',
        primary: false,
        accessRole: 'reader'
      }
    ])

    for (const [request, init] of fetchMock.mock.calls) {
      expect(String(request)).not.toContain(credentials.password)
      expect(String(request)).not.toContain(credentials.username)
      expect(init.headers.authorization).toMatch(/^Basic /)
    }
  })

  it('follows only Apple redirects and keeps authentication on the partition request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: 'https://p01-caldav.icloud.com/' }
      }))
      .mockResolvedValueOnce(xml(principalResponse))
      .mockResolvedValueOnce(xml(homeResponse))
      .mockResolvedValueOnce(xml(calendarsResponse))
    vi.stubGlobal('fetch', fetchMock)

    await expect(discoverAppleCalendars(credentials)).resolves.toHaveLength(2)
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('https://p01-caldav.icloud.com/')
    expect(fetchMock.mock.calls[1]?.[1]?.headers.authorization)
      .toBe(fetchMock.mock.calls[0]?.[1]?.headers.authorization)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'https://example.com/steal' }
    })))
    await expect(discoverAppleCalendars(credentials)).rejects.toMatchObject({
      message: 'Apple Calendar returned an unsafe calendar address.',
      retryable: false
    })
  })

  it('rejects malformed and oversized provider responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(xml('<html>not dav</html>')))
    await expect(discoverAppleCalendars(credentials)).rejects.toMatchObject({
      message: 'Apple Calendar returned malformed calendar data.',
      retryable: false
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(xml(principalResponse, 207, {
      'content-length': String(11 * 1024 * 1024)
    })))
    await expect(discoverAppleCalendars(credentials)).rejects.toMatchObject({
      message: 'Apple Calendar returned too much calendar data.',
      retryable: false
    })
  })

  it('classifies authentication and timeout failures safely', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    await expect(discoverAppleCalendars(credentials)).rejects.toMatchObject({
      authenticationFailure: true,
      retryable: false
    })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError')))
    const timeout = await discoverAppleCalendars(credentials).catch(error => error)
    expect(timeout).toBeInstanceOf(CalDavClientError)
    expect(timeout).toMatchObject({ retryable: true })
    expect(timeout.message).not.toContain(credentials.password)
  })

  it('uses expanded recurring events for busy time and ignores free or cancelled events', async () => {
    const calendarData = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:one\r\nDTSTART:20260907T090000Z\r\nDURATION:PT30M\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:free\r\nDTSTART:20260907T100000Z\r\nDTEND:20260907T103000Z\r\nTRANSP:TRANSPARENT\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:cancelled\r\nDTSTART:20260907T110000Z\r\nDTEND:20260907T113000Z\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\nEND:VCALENDAR`
    const report = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop><c:calendar-data>${calendarData}</c:calendar-data></d:prop></d:propstat></d:response></d:multistatus>`
    const fetchMock = vi.fn().mockResolvedValue(xml(report))
    vi.stubGlobal('fetch', fetchMock)

    await expect(appleBusyTimes(
      credentials,
      ['https://p01-caldav.icloud.com/123/calendars/home/'],
      '2026-09-01T00:00:00Z',
      '2026-10-01T00:00:00Z'
    )).resolves.toEqual([{ start: '2026-09-07T09:00:00Z', end: '2026-09-07T09:30:00Z' }])
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'REPORT' })
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain('<c:expand start="20260901T000000Z" end="20261001T000000Z"')
  })

  it('creates, updates and deletes one deterministic booking event', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const input = bookingInput()
    const expectedId = appleEventId(input.uid)

    await expect(upsertAppleCalendarEvent(
      credentials,
      'https://p01-caldav.icloud.com/123/calendars/home/',
      null,
      input
    )).resolves.toEqual({ id: expectedId, meetingUrl: input.meetingUrl })
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PUT')
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain('DTSTART:20260907T090000Z')
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).not.toContain(credentials.password)

    await upsertAppleCalendarEvent(
      credentials,
      'https://p01-caldav.icloud.com/123/calendars/home/',
      expectedId,
      { ...input, startsAt: new Date('2026-09-07T10:00:00Z') }
    )
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(expectedId)
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain('DTSTART:20260907T100000Z')

    await deleteAppleCalendarEvent(
      credentials,
      'https://p01-caldav.icloud.com/123/calendars/home/',
      expectedId
    )
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe('DELETE')
  })
})
