import { createHash } from 'node:crypto'
import { Temporal } from '@js-temporal/polyfill'
import { fetchWithTimeout } from '../fetch'
import { retryAfterMilliseconds } from '../errors'
import type { BusyPeriod, CalendarEventInput, CalendarRemoteEvent } from './provider'

const APPLE_CALDAV_URL = new URL('https://caldav.icloud.com/')
const MAX_XML_BYTES = 10 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 15_000

export interface CalDavCredentials {
  username: string
  password: string
}

export interface CalDavCalendar {
  id: string
  summary: string
  primary: boolean
  accessRole: 'reader' | 'writer' | 'owner'
  backgroundColor?: string
}

export class CalDavClientError extends Error {
  readonly retryable: boolean
  readonly retryAfterMs?: number
  readonly authenticationFailure: boolean

  constructor(message: string, options: {
    retryable?: boolean
    retryAfterMs?: number
    authenticationFailure?: boolean
    cause?: unknown
  } = {}) {
    super(message, { cause: options.cause })
    this.name = 'CalDavClientError'
    this.retryable = options.retryable ?? true
    this.retryAfterMs = options.retryAfterMs
    this.authenticationFailure = options.authenticationFailure ?? false
  }
}

function appleUrl(value: string | URL, base = APPLE_CALDAV_URL) {
  const url = value instanceof URL ? value : new URL(value, base)
  const appleHost = url.hostname === 'icloud.com' || url.hostname.endsWith('.icloud.com')
  if (url.protocol !== 'https:' || !appleHost || url.username || url.password) {
    throw new CalDavClientError('Apple Calendar returned an unsafe calendar address.', { retryable: false })
  }
  return url
}

function authorization(credentials: CalDavCredentials) {
  return `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`, 'utf8').toString('base64')}`
}

async function limitedText(response: Response) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_XML_BYTES) {
    throw new CalDavClientError('Apple Calendar returned too much calendar data.', { retryable: false })
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_XML_BYTES) {
      await reader.cancel()
      throw new CalDavClientError('Apple Calendar returned too much calendar data.', { retryable: false })
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

async function calDavResponse(
  credentials: CalDavCredentials,
  value: string | URL,
  init: RequestInit = {}
) {
  let url = appleUrl(value)
  let response: Response | null = null
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    try {
      response = await fetchWithTimeout(url, {
        ...init,
        redirect: 'manual',
        headers: {
          authorization: authorization(credentials),
          ...init.headers
        }
      }, REQUEST_TIMEOUT_MS)
    } catch (error) {
      throw new CalDavClientError('Apple Calendar did not respond in time. Try again.', { cause: error })
    }
    if (![301, 302, 307, 308].includes(response.status)) break
    const location = response.headers.get('location')
    if (!location || redirects === 3) {
      throw new CalDavClientError('Apple Calendar returned too many redirects.', { retryable: false })
    }
    url = appleUrl(location, url)
  }
  if (!response) throw new CalDavClientError('Apple Calendar did not respond in time. Try again.')

  appleUrl(response.url || url)
  if (response.status === 401 || response.status === 403) {
    throw new CalDavClientError(
      'Apple rejected these credentials. Use your Apple Account email and a current app-specific password.',
      { retryable: false, authenticationFailure: true }
    )
  }
  if (!response.ok && response.status !== 207 && response.status !== 404) {
    throw new CalDavClientError(`Apple Calendar request failed (${response.status}).`, {
      retryable: response.status === 408 || response.status === 429 || response.status >= 500,
      retryAfterMs: retryAfterMilliseconds(response)
    })
  }
  return response
}

async function xmlRequest(
  credentials: CalDavCredentials,
  value: string | URL,
  method: 'PROPFIND' | 'REPORT',
  body: string,
  depth: '0' | '1'
) {
  const response = await calDavResponse(credentials, value, {
    method,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      depth
    },
    body
  })
  if (response.status !== 207) {
    throw new CalDavClientError('Apple Calendar returned an unexpected response.', { retryable: false })
  }
  const xml = await limitedText(response)
  if (!/<(?:[\w.-]+:)?multistatus(?:\s|>)/i.test(xml)) {
    throw new CalDavClientError('Apple Calendar returned malformed calendar data.', { retryable: false })
  }
  return { xml, responseUrl: appleUrl(response.url || value) }
}

function decodeXml(value: string) {
  return value
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&amp;/g, '&')
}

function elementValues(xml: string, localName: string) {
  const name = localName.replace(/[^a-z-]/gi, '')
  const matcher = new RegExp(
    `<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${name}\\s*>`,
    'gi'
  )
  return [...xml.matchAll(matcher)].map(match => decodeXml(match[1]?.trim() ?? ''))
}

function responseBlocks(xml: string) {
  return elementValues(xml, 'response')
}

function firstHref(xml: string, property: string) {
  const propertyBody = elementValues(xml, property)[0]
  if (!propertyBody) return null
  return elementValues(propertyBody, 'href')[0] ?? null
}

export async function discoverAppleCalendars(credentials: CalDavCredentials) {
  const principalResult = await xmlRequest(credentials, APPLE_CALDAV_URL, 'PROPFIND', `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal /></d:prop></d:propfind>`, '0')
  const principalHref = firstHref(principalResult.xml, 'current-user-principal')
  if (!principalHref) {
    throw new CalDavClientError('Apple Calendar did not return an account principal.', { retryable: false })
  }
  const principalUrl = appleUrl(principalHref, principalResult.responseUrl)

  const homeResult = await xmlRequest(credentials, principalUrl, 'PROPFIND', `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set /></d:prop></d:propfind>`, '0')
  const homeHref = firstHref(homeResult.xml, 'calendar-home-set')
  if (!homeHref) {
    throw new CalDavClientError('Apple Calendar did not return a calendar home.', { retryable: false })
  }
  const homeUrl = appleUrl(homeHref, homeResult.responseUrl)

  const calendarResult = await xmlRequest(credentials, homeUrl, 'PROPFIND', `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">
  <d:prop><d:displayname /><d:resourcetype /><d:current-user-privilege-set /><c:supported-calendar-component-set /><a:calendar-color /></d:prop>
</d:propfind>`, '1')

  const calendars = responseBlocks(calendarResult.xml).flatMap((block) => {
    const resourceType = elementValues(block, 'resourcetype')[0] ?? ''
    const components = elementValues(block, 'supported-calendar-component-set')[0] ?? ''
    if (!/<(?:[\w.-]+:)?calendar(?:\s|\/|>)/i.test(resourceType)) return []
    if (components && !/name\s*=\s*["']VEVENT["']/i.test(components)) return []
    const href = elementValues(block, 'href')[0]
    if (!href) return []
    const id = appleUrl(href, calendarResult.responseUrl).toString()
    const privileges = elementValues(block, 'current-user-privilege-set')[0] ?? ''
    const canWrite = /<(?:[\w.-]+:)?write(?:\s|\/|>)/i.test(privileges)
      || /<(?:[\w.-]+:)?write-content(?:\s|\/|>)/i.test(privileges)
    const summary = elementValues(block, 'displayname')[0]?.replace(/<[^>]*>/g, '').trim() || 'Apple Calendar'
    const backgroundColor = elementValues(block, 'calendar-color')[0]?.replace(/<[^>]*>/g, '').trim()
    return [{
      id,
      summary,
      primary: false,
      accessRole: canWrite ? 'writer' as const : 'reader' as const,
      ...(backgroundColor ? { backgroundColor } : {})
    }]
  })

  if (!calendars.length) {
    throw new CalDavClientError('No Apple calendars were found for this account.', { retryable: false })
  }
  calendars[0] = { ...calendars[0]!, primary: true }
  return calendars
}

function compactUtc(value: string) {
  return Temporal.Instant.from(value).toString({ smallestUnit: 'second' })
    .replace(/[-:]/g, '').replace('.000', '')
}

function unfoldIcs(value: string) {
  return value.replace(/\r?\n[ \t]/g, '')
}

function property(block: string, name: string) {
  const matcher = new RegExp(`^${name}((?:;[^:]*)?):(.*)$`, 'im')
  const match = block.match(matcher)
  return match ? { params: match[1] ?? '', value: match[2]?.trim() ?? '' } : null
}

function icsInstant(entry: { params: string, value: string }, defaultTimeZone: string) {
  const dateOnly = /(?:^|;)VALUE=DATE(?:;|$)/i.test(entry.params) || /^\d{8}$/.test(entry.value)
  const match = entry.value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?$/)
  if (!match) throw new CalDavClientError('Apple Calendar returned an invalid event time.', { retryable: false })
  const [, year, month, day, hour = '00', minute = '00', second = '00', utc] = match
  const fields = {
    year: Number(year), month: Number(month), day: Number(day),
    hour: Number(hour), minute: Number(minute), second: Number(second)
  }
  if (utc) return { instant: Temporal.ZonedDateTime.from({ ...fields, timeZone: 'UTC' }).toInstant(), dateOnly }
  const zone = entry.params.match(/(?:^|;)TZID=(?:"([^"]+)"|([^;:]+))/i)?.slice(1).find(Boolean) ?? defaultTimeZone
  try {
    return { instant: Temporal.ZonedDateTime.from({ ...fields, timeZone: zone }).toInstant(), dateOnly }
  } catch (error) {
    throw new CalDavClientError('Apple Calendar returned an unsupported event time zone.', {
      retryable: false,
      cause: error
    })
  }
}

function icsDuration(value: string) {
  const match = value.match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i)
  if (!match) return null
  const [, weeks = '0', days = '0', hours = '0', minutes = '0', seconds = '0'] = match
  const totalSeconds = Number(weeks) * 7 * 86_400
    + Number(days) * 86_400
    + Number(hours) * 3_600
    + Number(minutes) * 60
    + Number(seconds)
  return totalSeconds > 0 ? totalSeconds : null
}

export function busyPeriodsFromCalendarData(calendarData: string, defaultTimeZone = 'UTC'): BusyPeriod[] {
  const unfolded = unfoldIcs(calendarData)
  const blocks = [...unfolded.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)\r?\nEND:VEVENT/gi)]
  const periods: BusyPeriod[] = []
  for (const match of blocks) {
    const block = match[1] ?? ''
    if (/^STATUS:CANCELLED$/im.test(block) || /^TRANSP:TRANSPARENT$/im.test(block)) continue
    const startEntry = property(block, 'DTSTART')
    if (!startEntry) continue
    const start = icsInstant(startEntry, defaultTimeZone)
    const endEntry = property(block, 'DTEND')
    const durationSeconds = property(block, 'DURATION')?.value
    const duration = durationSeconds ? icsDuration(durationSeconds) : null
    let end = start.instant
    if (endEntry) end = icsInstant(endEntry, defaultTimeZone).instant
    else if (duration) end = start.instant.add({ seconds: duration })
    else if (start.dateOnly) end = start.instant.add({ hours: 24 })
    if (Temporal.Instant.compare(end, start.instant) <= 0) continue
    periods.push({ start: start.instant.toString(), end: end.toString() })
  }
  return periods
}

async function busyForCalendar(
  credentials: CalDavCredentials,
  calendarId: string,
  from: string,
  to: string,
  defaultTimeZone: string
) {
  const start = compactUtc(from)
  const end = compactUtc(to)
  const result = await xmlRequest(credentials, calendarId, 'REPORT', `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-data><c:expand start="${start}" end="${end}" /></c:calendar-data></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${start}" end="${end}" /></c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`, '1')
  return elementValues(result.xml, 'calendar-data')
    .flatMap(data => busyPeriodsFromCalendarData(data, defaultTimeZone))
}

export async function appleBusyTimes(
  credentials: CalDavCredentials,
  calendarIds: string[],
  from: string,
  to: string,
  defaultTimeZone = 'UTC'
) {
  const periods: BusyPeriod[] = []
  for (let index = 0; index < calendarIds.length; index += 4) {
    const chunk = calendarIds.slice(index, index + 4)
    periods.push(...(await Promise.all(
      chunk.map(id => busyForCalendar(credentials, id, from, to, defaultTimeZone))
    )).flat())
  }
  return periods
}

function escapeIcs(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([;,])/g, '\\$1')
}

function foldIcsLine(line: string) {
  const parts: string[] = []
  let remaining = line
  while (Buffer.byteLength(remaining, 'utf8') > 73) {
    let end = Math.min(73, remaining.length)
    while (end > 1 && Buffer.byteLength(remaining.slice(0, end), 'utf8') > 73) end -= 1
    parts.push(remaining.slice(0, end))
    remaining = ` ${remaining.slice(end)}`
  }
  parts.push(remaining)
  return parts.join('\r\n')
}

function icsDate(value: Date) {
  return value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function eventDescription(input: CalendarEventInput) {
  const location = ['google_meet', 'microsoft_teams', 'zoom'].includes(input.locationType)
    ? input.meetingUrl ?? input.locationType.replaceAll('_', ' ')
    : input.locationDetails
  return [
    input.description,
    `Guest: ${input.attendeeName} (${input.attendeeEmail})`,
    `Where: ${location}`,
    input.meetingUrl ? `Join: ${input.meetingUrl}` : null,
    input.notes ? `Guest notes:\n${input.notes}` : null
  ].filter(Boolean).join('\n\n').slice(0, 10_000)
}

function eventCalendar(input: CalendarEventInput, eventId: string) {
  const uid = `schedra-${eventId.replace(/\.ics$/, '')}@schedra.xyz`
  const location = ['google_meet', 'microsoft_teams', 'zoom'].includes(input.locationType)
    ? input.meetingUrl ?? input.locationType.replaceAll('_', ' ')
    : input.locationDetails
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Schedra//Booking Calendar//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(input.startsAt)}`,
    `DTEND:${icsDate(input.endsAt)}`,
    `SUMMARY:${escapeIcs(`${input.title} with ${input.attendeeName}`)}`,
    `DESCRIPTION:${escapeIcs(eventDescription(input))}`,
    ...(location ? [`LOCATION:${escapeIcs(location)}`] : []),
    ...(input.meetingUrl ? [`URL:${escapeIcs(input.meetingUrl)}`] : []),
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR'
  ]
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`
}

export function appleEventId(uid: string) {
  return `schedra-${createHash('sha256').update(uid).digest('hex').slice(0, 40)}.ics`
}

function eventUrl(calendarId: string, eventId: string) {
  const calendar = appleUrl(calendarId)
  const base = calendar.pathname.endsWith('/') ? calendar : new URL(`${calendar.pathname}/`, calendar)
  return appleUrl(encodeURIComponent(eventId), base)
}

export async function upsertAppleCalendarEvent(
  credentials: CalDavCredentials,
  calendarId: string,
  eventId: string | null,
  input: CalendarEventInput
): Promise<CalendarRemoteEvent> {
  const remoteId = eventId ?? appleEventId(input.calendarEventKey ?? input.uid)
  const response = await calDavResponse(credentials, eventUrl(calendarId, remoteId), {
    method: 'PUT',
    headers: { 'content-type': 'text/calendar; charset=utf-8' },
    body: eventCalendar(input, remoteId)
  })
  if (![200, 201, 204].includes(response.status)) {
    throw new CalDavClientError(`Apple Calendar could not save the booking (${response.status}).`)
  }
  return { id: remoteId, meetingUrl: input.meetingUrl ?? null }
}

export async function deleteAppleCalendarEvent(
  credentials: CalDavCredentials,
  calendarId: string,
  eventId: string
) {
  const response = await calDavResponse(credentials, eventUrl(calendarId, eventId), { method: 'DELETE' })
  if (![200, 204, 404].includes(response.status)) {
    throw new CalDavClientError(`Apple Calendar could not remove the booking (${response.status}).`)
  }
}
