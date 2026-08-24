import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { calendarConnections } from '../database/schema'
import { useDatabase } from './database'
import { decryptCredential, encryptCredential } from './credential-crypto'
import { useEnv } from './env'
import { fetchWithTimeout } from './fetch'
import type { CalendarEventInput } from './calendar-provider'

export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy'
]

export interface GoogleCalendarItem {
  id: string
  summary: string
  primary: boolean
  accessRole: 'freeBusyReader' | 'reader' | 'writer' | 'owner'
  backgroundColor?: string
}

interface GoogleTokens {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
}

interface GoogleEventResponse {
  id: string
  hangoutLink?: string
  conferenceData?: {
    entryPoints?: { entryPointType?: string, uri?: string }[]
    createRequest?: { status?: { statusCode?: string } }
  }
}

export class CalendarUnavailableError extends Error {}
export class CalendarSelectionError extends Error {}

export function googleAuthorizationUrl(state: string, email: string) {
  const env = useEnv()
  if (!env.googleClientId || !env.googleClientSecret) throw new CalendarUnavailableError('Google Calendar is not configured.')
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: `${env.schedraUrl}/api/integrations/google-calendar/callback`,
    response_type: 'code',
    scope: GOOGLE_CALENDAR_SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    login_hint: email,
    state
  }).toString()
  return url.toString()
}

export async function exchangeGoogleCode(code: string): Promise<GoogleTokens> {
  const env = useEnv()
  const response = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.googleClientId!,
      client_secret: env.googleClientSecret!,
      redirect_uri: `${env.schedraUrl}/api/integrations/google-calendar/callback`,
      grant_type: 'authorization_code'
    })
  })
  if (!response.ok) throw new CalendarUnavailableError('Google did not complete the calendar connection.')
  return response.json() as Promise<GoogleTokens>
}

export async function saveGoogleConnection(userId: string, tokens: GoogleTokens) {
  if (!tokens.refresh_token) throw new CalendarUnavailableError('Google did not return offline access. Please connect again.')
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)
  await useDatabase().insert(calendarConnections).values({
    userId,
    accessTokenEncrypted: encryptCredential(tokens.access_token),
    refreshTokenEncrypted: encryptCredential(tokens.refresh_token),
    accessTokenExpiresAt: expiresAt,
    scope: tokens.scope ?? GOOGLE_CALENDAR_SCOPES.join(' '),
    status: 'active',
    lastError: null
  }).onConflictDoUpdate({
    target: [calendarConnections.userId, calendarConnections.provider],
    set: {
      accessTokenEncrypted: encryptCredential(tokens.access_token),
      refreshTokenEncrypted: encryptCredential(tokens.refresh_token),
      accessTokenExpiresAt: expiresAt,
      scope: tokens.scope ?? GOOGLE_CALENDAR_SCOPES.join(' '),
      status: 'active',
      lastError: null,
      updatedAt: sql`now()`
    }
  })
}

export async function googleConnectionFor(userId: string) {
  const [connection] = await useDatabase().select().from(calendarConnections)
    .where(and(eq(calendarConnections.userId, userId), eq(calendarConnections.provider, 'google'))).limit(1)
  return connection ?? null
}

async function accessToken(userId: string, forceRefresh = false) {
  const connection = await googleConnectionFor(userId)
  if (!connection) return null
  if (connection.status !== 'active') throw new CalendarUnavailableError('The host calendar needs to be reconnected.')
  if (!forceRefresh && connection.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
    return { connection, token: decryptCredential(connection.accessTokenEncrypted) }
  }

  const env = useEnv()
  const response = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.googleClientId!,
      client_secret: env.googleClientSecret!,
      refresh_token: decryptCredential(connection.refreshTokenEncrypted),
      grant_type: 'refresh_token'
    })
  })
  if (!response.ok) {
    await useDatabase().update(calendarConnections).set({
      status: 'needs_reauthorization',
      lastError: 'Google authorization expired.',
      updatedAt: sql`now()`
    }).where(eq(calendarConnections.id, connection.id))
    throw new CalendarUnavailableError('The host calendar needs to be reconnected.')
  }
  const tokens = await response.json() as GoogleTokens
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)
  await useDatabase().update(calendarConnections).set({
    accessTokenEncrypted: encryptCredential(tokens.access_token),
    accessTokenExpiresAt: expiresAt,
    lastError: null,
    updatedAt: sql`now()`
  }).where(eq(calendarConnections.id, connection.id))
  return { connection: { ...connection, accessTokenExpiresAt: expiresAt }, token: tokens.access_token }
}

async function googleResponse(userId: string, path: string, init?: RequestInit) {
  let auth = await accessToken(userId)
  if (!auth) throw new CalendarUnavailableError('Google Calendar is not connected.')
  const request = (token: string) => fetchWithTimeout(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json', ...init?.headers }
  })
  let response = await request(auth.token)
  if (response.status === 401) {
    auth = await accessToken(userId, true)
    if (!auth) throw new CalendarUnavailableError('Google Calendar is not connected.')
    response = await request(auth.token)
  }
  if (!response.ok && ![404, 410].includes(response.status)) {
    const message = `Google Calendar request failed (${response.status}).`
    await useDatabase().update(calendarConnections).set({ lastError: message, updatedAt: sql`now()` })
      .where(eq(calendarConnections.id, auth.connection.id))
    throw new CalendarUnavailableError(message)
  }
  return response
}

async function googleRequest<T>(userId: string, path: string, init?: RequestInit): Promise<T> {
  const response = await googleResponse(userId, path, init)
  if (!response.ok) throw new CalendarUnavailableError(`Google Calendar request failed (${response.status}).`)
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function listGoogleCalendars(userId: string): Promise<GoogleCalendarItem[]> {
  const calendars: GoogleCalendarItem[] = []
  let pageToken: string | undefined
  do {
    const query = new URLSearchParams({ maxResults: '250', ...(pageToken ? { pageToken } : {}) })
    const page = await googleRequest<{ items?: GoogleCalendarItem[], nextPageToken?: string }>(userId, `/users/me/calendarList?${query}`)
    calendars.push(...(page.items ?? []).map(item => ({
      id: item.id,
      summary: item.summary,
      primary: Boolean(item.primary),
      accessRole: item.accessRole,
      backgroundColor: item.backgroundColor
    })))
    pageToken = page.nextPageToken
  } while (pageToken)
  await useDatabase().update(calendarConnections).set({
    lastCheckedAt: sql`now()`,
    lastError: null,
    updatedAt: sql`now()`
  }).where(and(eq(calendarConnections.userId, userId), eq(calendarConnections.provider, 'google')))
  return calendars
}

export async function initializeGoogleCalendars(userId: string) {
  const calendars = await listGoogleCalendars(userId)
  const primary = calendars.find(calendar => calendar.primary) ?? calendars[0]
  if (!primary) throw new CalendarUnavailableError('No Google calendars were found.')
  const writable = [primary, ...calendars].find(calendar => ['writer', 'owner'].includes(calendar.accessRole))
  await useDatabase().update(calendarConnections).set({
    accountLabel: primary.id,
    conflictCalendarIds: [primary.id],
    writeCalendarId: writable?.id ?? null,
    lastCheckedAt: sql`now()`,
    updatedAt: sql`now()`
  }).where(and(eq(calendarConnections.userId, userId), eq(calendarConnections.provider, 'google')))
}

interface BusyPeriod { start: string, end: string }
interface BusyCacheEntry {
  from: number
  to: number
  expiresAt: number
  request: Promise<BusyPeriod[]>
}

const busyCache = new Map<string, BusyCacheEntry>()
const BUSY_CACHE_MS = 15_000

export function clearGoogleBusyCache() {
  busyCache.clear()
}

export async function googleBusyTimes(userId: string, from: string, to: string) {
  const connection = await googleConnectionFor(userId)
  if (!connection) return []
  if (connection.status !== 'active') throw new CalendarUnavailableError('The host calendar needs to be reconnected.')
  if (!connection.conflictCalendarIds.length) return []
  const requestedFrom = Date.parse(from)
  const requestedTo = Date.parse(to)
  const cacheKey = `${connection.id}:${connection.updatedAt.toISOString()}:${connection.conflictCalendarIds.join('\u0000')}`
  const cached = busyCache.get(cacheKey)

  if (cached && cached.expiresAt > Date.now() && requestedFrom >= cached.from && requestedTo <= cached.to) {
    return (await cached.request).filter(period => Date.parse(period.end) > requestedFrom && Date.parse(period.start) < requestedTo)
  }

  const request = googleRequest<{ calendars: Record<string, { busy?: BusyPeriod[], errors?: unknown[] }> }>(
    userId,
    '/freeBusy',
    { method: 'POST', body: JSON.stringify({ timeMin: from, timeMax: to, timeZone: 'UTC', items: connection.conflictCalendarIds.map(id => ({ id })) }) }
  ).then((result) => {
    const entries = Object.values(result.calendars)
    if (entries.some(entry => entry.errors?.length)) throw new CalendarUnavailableError('Google could not check every selected calendar.')
    return entries.flatMap(entry => entry.busy ?? [])
  })

  if (busyCache.size >= 1000) {
    const oldestKey = busyCache.keys().next().value
    if (oldestKey) busyCache.delete(oldestKey)
  }
  busyCache.set(cacheKey, { from: requestedFrom, to: requestedTo, expiresAt: Date.now() + BUSY_CACHE_MS, request })

  try {
    return await request
  } catch (error) {
    busyCache.delete(cacheKey)
    throw error
  }
}

export async function googleCalendarConnection(userId: string) {
  const connection = await googleConnectionFor(userId)
  if (!connection) return { connected: false as const, configured: Boolean(useEnv().googleClientId) }
  return {
    connected: connection.status === 'active',
    configured: Boolean(useEnv().googleClientId),
    status: connection.status,
    accountLabel: connection.accountLabel,
    conflictCalendarIds: connection.conflictCalendarIds,
    writeCalendarId: connection.writeCalendarId,
    lastError: connection.lastError
  }
}

export async function updateGoogleCalendarSelection(userId: string, conflictCalendarIds: string[], writeCalendarId: string) {
  const calendars = await listGoogleCalendars(userId)
  const byId = new Map(calendars.map(calendar => [calendar.id, calendar]))
  if (conflictCalendarIds.some(id => !byId.has(id))) throw new CalendarSelectionError('Choose calendars from your connected Google account.')
  const write = byId.get(writeCalendarId)
  if (!write || !['writer', 'owner'].includes(write.accessRole)) {
    throw new CalendarSelectionError('Choose a calendar where Schedra may create events.')
  }
  await useDatabase().update(calendarConnections).set({
    conflictCalendarIds,
    writeCalendarId,
    accountLabel: calendars.find(calendar => calendar.primary)?.id ?? writeCalendarId,
    lastCheckedAt: sql`now()`,
    lastError: null,
    updatedAt: sql`now()`
  }).where(and(eq(calendarConnections.userId, userId), eq(calendarConnections.provider, 'google')))
}

function eventBody(input: CalendarEventInput) {
  const manageUrl = `${useEnv().schedraUrl}/booking/${input.uid}`
  const location = input.locationType === 'google_meet'
    ? 'Google Meet'
    : input.locationDetails
  const description = [
    input.description,
    `Guest: ${input.attendeeName} (${input.attendeeEmail})`,
    `Where: ${location}`,
    input.notes ? `Guest notes:\n${input.notes}` : null,
    `Manage this booking: ${manageUrl}`
  ].filter(Boolean).join('\n\n')
  return {
    summary: `${input.title} with ${input.attendeeName}`,
    description,
    location: input.locationType === 'google_meet' ? undefined : input.locationDetails,
    start: { dateTime: input.startsAt.toISOString() },
    end: { dateTime: input.endsAt.toISOString() },
    attendees: [
      { email: input.attendeeEmail, displayName: input.attendeeName },
      ...input.additionalGuestEmails.map(email => ({ email }))
    ],
    ...input.locationType === 'google_meet' && !input.meetingUrl
      ? {
          conferenceData: {
            createRequest: {
              requestId: `schedra-${createHash('sha256').update(input.uid).digest('hex').slice(0, 32)}`,
              conferenceSolutionKey: { type: 'hangoutsMeet' }
            }
          }
        }
      : {},
    extendedProperties: { private: { schedraBookingUid: input.uid } }
  }
}

function meetingUrl(event: GoogleEventResponse) {
  return event.hangoutLink
    ?? event.conferenceData?.entryPoints?.find(point => point.entryPointType === 'video')?.uri
    ?? null
}

export function googleEventId(uid: string) {
  return `schedra${createHash('sha256').update(uid).digest('hex')}`
}

export async function upsertGoogleCalendarEvent(
  userId: string,
  calendarId: string,
  eventId: string | null,
  input: CalendarEventInput
) {
  const calendar = encodeURIComponent(calendarId)
  const query = new URLSearchParams({ sendUpdates: 'all', conferenceDataVersion: '1' })
  // A deterministic, Google-compatible event id makes creation idempotent if
  // the process stops after Google accepts the event but before the mapping is saved.
  const candidateId = eventId ?? googleEventId(input.uid)

  const response = await googleResponse(
    userId,
    `/calendars/${calendar}/events/${encodeURIComponent(candidateId)}?${query}`,
    { method: 'PATCH', body: JSON.stringify(eventBody(input)) }
  )
  if (response.ok) {
    const event = await response.json() as GoogleEventResponse
    return { ...event, meetingUrl: meetingUrl(event) }
  }
  if (response.status !== 404) throw new CalendarUnavailableError(`Google Calendar request failed (${response.status}).`)

  const event = await googleRequest<GoogleEventResponse>(userId, `/calendars/${calendar}/events?${query}`, {
    method: 'POST',
    body: JSON.stringify({ id: candidateId, ...eventBody(input) })
  })
  return { ...event, meetingUrl: meetingUrl(event) }
}

export async function deleteGoogleCalendarEvent(userId: string, calendarId: string, eventId: string) {
  const response = await googleResponse(
    userId,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?${new URLSearchParams({ sendUpdates: 'all' })}`,
    { method: 'DELETE' }
  )
  if (![404, 410].includes(response.status) && !response.ok) {
    throw new CalendarUnavailableError(`Google Calendar request failed (${response.status}).`)
  }
}

export async function disconnectGoogleCalendar(userId: string) {
  const connection = await googleConnectionFor(userId)
  if (!connection) return

  try {
    const token = decryptCredential(connection.refreshTokenEncrypted)
    await fetchWithTimeout(`https://oauth2.googleapis.com/revoke?${new URLSearchParams({ token })}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })
  } catch {
    // Local disconnection must still succeed if Google's revoke endpoint is unavailable.
  }

  await useDatabase().delete(calendarConnections).where(eq(calendarConnections.id, connection.id))
}
