import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { calendarConnections } from '../../database/schema'
import { useDatabase } from '../../database'
import { decryptCredential, encryptCredential } from './credential-crypto'
import { useEnv } from '../../config/env'
import { fetchWithTimeout } from '../fetch'
import type { CalendarEventInput } from './provider'
import { IntegrationUnavailableError, retryAfterMilliseconds } from '../errors'
import { ensureDefaultCalendarDestination } from '../../repositories/calendar-connection'

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

export class CalendarUnavailableError extends IntegrationUnavailableError {
  constructor(message: string, options: { retryable?: boolean, retryAfterMs?: number, cause?: unknown } = {}) {
    super(message, { provider: 'google', ...options })
    this.name = 'CalendarUnavailableError'
  }
}
export class CalendarSelectionError extends Error {}

export function googleAuthorizationUrl(state: string, email: string, codeChallenge?: string) {
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
    state,
    ...(codeChallenge
      ? {
          code_challenge: codeChallenge,
          code_challenge_method: 'S256'
        }
      : {})
  }).toString()
  return url.toString()
}

export async function exchangeGoogleCode(code: string, codeVerifier?: string): Promise<GoogleTokens> {
  const env = useEnv()
  const response = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.googleClientId!,
      client_secret: env.googleClientSecret!,
      redirect_uri: `${env.schedraUrl}/api/integrations/google-calendar/callback`,
      grant_type: 'authorization_code',
      ...(codeVerifier ? { code_verifier: codeVerifier } : {})
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
      preferencesConfiguredAt: null,
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
  if (connection.status !== 'active') {
    throw new CalendarUnavailableError('The host calendar needs to be reconnected.', { retryable: false })
  }
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
    if (response.status === 429 || response.status >= 500) {
      throw new CalendarUnavailableError('Google Calendar is temporarily unavailable.', {
        retryable: true,
        retryAfterMs: retryAfterMilliseconds(response)
      })
    }
    await useDatabase().update(calendarConnections).set({
      status: 'needs_reauthorization',
      lastError: 'Google authorization expired.',
      lastCheckedAt: sql`now()`,
      updatedAt: sql`now()`
    }).where(eq(calendarConnections.id, connection.id))
    throw new CalendarUnavailableError('The host calendar needs to be reconnected.', { retryable: false })
  }
  const tokens = await response.json() as GoogleTokens
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)
  await useDatabase().update(calendarConnections).set({
    accessTokenEncrypted: encryptCredential(tokens.access_token),
    accessTokenExpiresAt: expiresAt,
    lastError: null,
    lastCheckedAt: sql`now()`,
    updatedAt: sql`now()`
  }).where(eq(calendarConnections.id, connection.id))
  return { connection: { ...connection, accessTokenExpiresAt: expiresAt }, token: tokens.access_token }
}

async function googleResponse(userId: string, path: string, init?: RequestInit) {
  let auth = await accessToken(userId)
  if (!auth) throw new CalendarUnavailableError('Google Calendar is not connected.', { retryable: false })
  const request = (token: string) => fetchWithTimeout(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json', ...init?.headers }
  })
  let response = await request(auth.token)
  if (response.status === 401) {
    auth = await accessToken(userId, true)
    if (!auth) throw new CalendarUnavailableError('Google Calendar is not connected.', { retryable: false })
    response = await request(auth.token)
  }
  if (!response.ok && ![404, 410].includes(response.status)) {
    const message = `Google Calendar request failed (${response.status}).`
    await useDatabase().update(calendarConnections).set({
      lastError: message,
      lastCheckedAt: sql`now()`,
      updatedAt: sql`now()`
    })
      .where(eq(calendarConnections.id, auth.connection.id))
    throw new CalendarUnavailableError(message, {
      retryable: response.status === 429 || response.status >= 500,
      retryAfterMs: retryAfterMilliseconds(response)
    })
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
  const [defaultDestination] = await useDatabase().select({ id: calendarConnections.id })
    .from(calendarConnections)
    .where(and(
      eq(calendarConnections.userId, userId),
      eq(calendarConnections.isDefaultWriteDestination, true)
    )).limit(1)
  const connection = await googleConnectionFor(userId)
  await useDatabase().update(calendarConnections).set({
    accountLabel: primary.id,
    conflictCalendarIds: [primary.id],
    writeCalendarId: writable?.id ?? null,
    isDefaultWriteDestination: !defaultDestination || defaultDestination.id === connection?.id,
    lastCheckedAt: sql`now()`,
    updatedAt: sql`now()`
  }).where(and(eq(calendarConnections.userId, userId), eq(calendarConnections.provider, 'google')))
}

interface BusyPeriod { start: string, end: string }
interface FreeBusyCalendarResult {
  busy?: BusyPeriod[]
  errors?: Array<{ reason?: string }>
}
interface FreeBusyResponse {
  calendars: Record<string, FreeBusyCalendarResult>
}
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

function freeBusy(userId: string, calendarIds: string[], from: string, to: string) {
  return googleRequest<FreeBusyResponse>(userId, '/freeBusy', {
    method: 'POST',
    body: JSON.stringify({
      timeMin: from,
      timeMax: to,
      timeZone: 'UTC',
      items: calendarIds.map(id => ({ id }))
    })
  })
}

function failedFreeBusyCalendarIds(result: FreeBusyResponse) {
  return Object.entries(result.calendars)
    .filter(([, entry]) => entry.errors?.length)
    .map(([id]) => id)
}

export async function googleBusyTimes(userId: string, from: string, to: string) {
  const connection = await googleConnectionFor(userId)
  if (!connection) return []
  if (connection.status !== 'active') {
    throw new CalendarUnavailableError('The host calendar needs to be reconnected.', { retryable: false })
  }
  if (!connection.conflictCalendarIds.length) return []
  const requestedFrom = Date.parse(from)
  const requestedTo = Date.parse(to)
  const cacheKey = `${connection.id}:${connection.updatedAt.toISOString()}:${connection.conflictCalendarIds.join('\u0000')}`
  const cached = busyCache.get(cacheKey)

  if (cached && cached.expiresAt > Date.now() && requestedFrom >= cached.from && requestedTo <= cached.to) {
    return (await cached.request).filter(period => Date.parse(period.end) > requestedFrom && Date.parse(period.start) < requestedTo)
  }

  const request = freeBusy(userId, connection.conflictCalendarIds, from, to).then(async (result) => {
    const failedIds = failedFreeBusyCalendarIds(result)
    if (!failedIds.length) return Object.values(result.calendars).flatMap(entry => entry.busy ?? [])

    const permanentFailures = failedIds.filter((id) => {
      const errors = result.calendars[id]?.errors ?? []
      return errors.length > 0 && errors.every(error => error.reason === 'notFound')
    })
    const usableIds = connection.conflictCalendarIds.filter(id => !permanentFailures.includes(id))

    // Google returns per-calendar `notFound` errors for some subscribed
    // calendars (notably holiday and week-number feeds) even though they are
    // present in Calendar List. Keep healthy calendars protecting the host,
    // and remove only entries Google has confirmed it cannot query.
    if (permanentFailures.length === failedIds.length && usableIds.length) {
      const count = permanentFailures.length
      await useDatabase().update(calendarConnections).set({
        conflictCalendarIds: usableIds,
        lastError: `${count} selected ${count === 1 ? 'calendar was' : 'calendars were'} removed because Google cannot check ${count === 1 ? 'its' : 'their'} busy times.`,
        updatedAt: sql`now()`
      }).where(and(
        eq(calendarConnections.id, connection.id),
        eq(calendarConnections.conflictCalendarIds, connection.conflictCalendarIds)
      ))
      return usableIds.flatMap(id => result.calendars[id]?.busy ?? [])
    }

    const message = usableIds.length
      ? 'Google could not check every selected calendar.'
      : 'Google cannot check busy times on the selected calendar.'
    await useDatabase().update(calendarConnections).set({
      lastError: message,
      updatedAt: sql`now()`
    }).where(eq(calendarConnections.id, connection.id))
    throw new CalendarUnavailableError(message)
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
    setupRequired: connection.status === 'active' && !connection.preferencesConfiguredAt,
    writeEnabled: Boolean(connection.writeCalendarId),
    defaultForBookings: connection.isDefaultWriteDestination,
    accountLabel: connection.accountLabel,
    conflictCalendarIds: connection.conflictCalendarIds,
    writeCalendarId: connection.writeCalendarId,
    lastError: connection.lastError,
    lastCheckedAt: connection.lastCheckedAt?.toISOString() ?? null
  }
}

export async function updateGoogleCalendarSelection(
  userId: string,
  conflictCalendarIds: string[],
  writeCalendarId: string,
  defaultForBookings = false
) {
  const calendars = await listGoogleCalendars(userId)
  const byId = new Map(calendars.map(calendar => [calendar.id, calendar]))
  if (conflictCalendarIds.some(id => !byId.has(id))) throw new CalendarSelectionError('Choose calendars from your connected Google account.')
  const write = byId.get(writeCalendarId)
  if (!write || !['writer', 'owner'].includes(write.accessRole)) {
    throw new CalendarSelectionError('Choose a calendar where Schedra may create events.')
  }

  const checkFrom = new Date()
  const checkTo = new Date(checkFrom.getTime() + 60 * 60_000)
  const check = await freeBusy(userId, conflictCalendarIds, checkFrom.toISOString(), checkTo.toISOString())
  const failedIds = failedFreeBusyCalendarIds(check)
  if (failedIds.length) {
    const labels = failedIds.map(id => byId.get(id)?.summary ?? 'a selected calendar')
    throw new CalendarSelectionError(
      `Google cannot check busy times on ${labels.join(', ')}. Leave ${failedIds.length === 1 ? 'that calendar' : 'those calendars'} unchecked.`
    )
  }
  await useDatabase().transaction(async (tx) => {
    if (defaultForBookings) {
      await tx.update(calendarConnections).set({
        isDefaultWriteDestination: false,
        updatedAt: sql`now()`
      }).where(eq(calendarConnections.userId, userId))
    }
    await tx.update(calendarConnections).set({
      conflictCalendarIds,
      writeCalendarId,
      ...(defaultForBookings ? { isDefaultWriteDestination: true } : {}),
      preferencesConfiguredAt: sql`now()`,
      accountLabel: calendars.find(calendar => calendar.primary)?.id ?? writeCalendarId,
      lastCheckedAt: sql`now()`,
      lastError: null,
      updatedAt: sql`now()`
    }).where(and(eq(calendarConnections.userId, userId), eq(calendarConnections.provider, 'google')))
  })
}

function eventBody(input: CalendarEventInput) {
  const manageUrl = `${useEnv().schedraUrl}/booking/${input.uid}`
  const generatedMeeting = ['google_meet', 'microsoft_teams', 'zoom'].includes(input.locationType)
  const location = input.locationType === 'google_meet'
    ? 'Google Meet'
    : input.locationType === 'microsoft_teams'
      ? 'Microsoft Teams'
      : input.locationType === 'zoom' ? 'Zoom' : input.locationDetails
  const description = [
    input.description,
    `Guest: ${input.attendeeName} (${input.attendeeEmail})`,
    `Where: ${location}`,
    input.meetingUrl ? `Join: ${input.meetingUrl}` : null,
    input.notes ? `Guest notes:\n${input.notes}` : null,
    `Manage this booking: ${manageUrl}`
  ].filter(Boolean).join('\n\n')
  return {
    summary: `${input.title} with ${input.attendeeName}`,
    description,
    location: generatedMeeting ? input.meetingUrl ?? location : input.locationDetails,
    start: { dateTime: input.startsAt.toISOString() },
    end: { dateTime: input.endsAt.toISOString() },
    attendees: input.inviteGuests === false
      ? []
      : [
          { email: input.attendeeEmail, displayName: input.attendeeName },
          ...input.additionalGuestEmails.map(email => ({ email }))
        ],
    ...input.locationType === 'google_meet' && !input.meetingUrl
      ? {
          conferenceData: {
            createRequest: {
              requestId: `schedra-${createHash('sha256').update(input.calendarEventKey ?? input.uid).digest('hex').slice(0, 32)}`,
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
  const query = new URLSearchParams({
    sendUpdates: input.inviteGuests === false ? 'none' : 'all',
    conferenceDataVersion: '1'
  })
  // A deterministic, Google-compatible event id makes creation idempotent if
  // the process stops after Google accepts the event but before the mapping is saved.
  const candidateId = eventId ?? googleEventId(input.calendarEventKey ?? input.uid)

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
  await ensureDefaultCalendarDestination(userId)
}
