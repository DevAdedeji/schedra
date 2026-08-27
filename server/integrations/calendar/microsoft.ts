import { createHash } from 'node:crypto'
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm'
import { calendarConnections } from '../../database/schema'
import { useDatabase } from '../../database'
import { useEnv } from '../../config/env'
import { fetchWithTimeout } from '../fetch'
import { IntegrationUnavailableError, retryAfterMilliseconds } from '../errors'
import { decryptCredential, encryptCredential } from './credential-crypto'
import type { CalendarEventInput } from './provider'

const GRAPH_ORIGIN = 'https://graph.microsoft.com'
const GRAPH_BASE = `${GRAPH_ORIGIN}/v1.0`
const MICROSOFT_AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0'

export const MICROSOFT_CALENDAR_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
  'Calendars.ReadWrite'
]

interface MicrosoftTokens {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
}

interface MicrosoftUser {
  id: string
  displayName?: string
  mail?: string
  userPrincipalName?: string
}

interface MicrosoftCalendar {
  id: string
  name: string
  isDefaultCalendar?: boolean
  canEdit?: boolean
  hexColor?: string
  isShared?: boolean
  isSharedWithMe?: boolean
  owner?: { name?: string, address?: string }
}

interface MicrosoftEvent {
  id: string
  showAs?: string
  isCancelled?: boolean
  start?: { dateTime?: string, timeZone?: string }
  end?: { dateTime?: string, timeZone?: string }
}

interface GraphPage<T> {
  'value'?: T[]
  '@odata.nextLink'?: string
}

export interface MicrosoftCalendarItem {
  id: string
  summary: string
  primary: boolean
  accessRole: 'reader' | 'writer' | 'owner'
  backgroundColor?: string
  shared?: boolean
  owner?: string
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

export function clearMicrosoftBusyCache() {
  busyCache.clear()
}

export class MicrosoftCalendarUnavailableError extends IntegrationUnavailableError {
  constructor(message: string, options: { retryable?: boolean, retryAfterMs?: number, cause?: unknown } = {}) {
    super(message, { provider: 'microsoft', ...options })
    this.name = 'MicrosoftCalendarUnavailableError'
  }
}

export class MicrosoftCalendarSelectionError extends Error {}

function credentials() {
  const env = useEnv()
  if (!env.microsoftClientId || !env.microsoftClientSecret) {
    throw new MicrosoftCalendarUnavailableError('Microsoft Calendar is not configured.', { retryable: false })
  }
  return env
}

function callbackUrl() {
  return `${useEnv().schedraUrl}/api/integrations/microsoft-calendar/callback`
}

export function microsoftAuthorizationUrl(state: string, email: string) {
  const env = credentials()
  const url = new URL(`${MICROSOFT_AUTHORITY}/authorize`)
  url.search = new URLSearchParams({
    client_id: env.microsoftClientId!,
    response_type: 'code',
    redirect_uri: callbackUrl(),
    response_mode: 'query',
    scope: MICROSOFT_CALENDAR_SCOPES.join(' '),
    state,
    login_hint: email,
    prompt: 'select_account'
  }).toString()
  return url.toString()
}

async function tokenRequest(body: URLSearchParams) {
  const response = await fetchWithTimeout(`${MICROSOFT_AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!response.ok) {
    throw new MicrosoftCalendarUnavailableError('Microsoft did not complete the calendar connection.', {
      retryable: response.status === 429 || response.status >= 500,
      retryAfterMs: retryAfterMilliseconds(response)
    })
  }
  return response.json() as Promise<MicrosoftTokens>
}

export async function exchangeMicrosoftCode(code: string) {
  const env = credentials()
  return tokenRequest(new URLSearchParams({
    client_id: env.microsoftClientId!,
    client_secret: env.microsoftClientSecret!,
    code,
    redirect_uri: callbackUrl(),
    grant_type: 'authorization_code',
    scope: MICROSOFT_CALENDAR_SCOPES.join(' ')
  }))
}

export async function microsoftConnectionFor(userId: string) {
  const [connection] = await useDatabase().select().from(calendarConnections)
    .where(and(
      eq(calendarConnections.userId, userId),
      eq(calendarConnections.provider, 'microsoft')
    )).limit(1)
  return connection ?? null
}

async function accessToken(userId: string, forceRefresh = false) {
  const connection = await microsoftConnectionFor(userId)
  if (!connection) return null
  if (connection.status !== 'active') {
    throw new MicrosoftCalendarUnavailableError('Microsoft Calendar needs to be reconnected.', { retryable: false })
  }
  if (!forceRefresh && connection.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
    return { connection, token: decryptCredential(connection.accessTokenEncrypted) }
  }

  const env = credentials()
  let tokens: MicrosoftTokens
  try {
    tokens = await tokenRequest(new URLSearchParams({
      client_id: env.microsoftClientId!,
      client_secret: env.microsoftClientSecret!,
      refresh_token: decryptCredential(connection.refreshTokenEncrypted),
      grant_type: 'refresh_token',
      scope: MICROSOFT_CALENDAR_SCOPES.join(' ')
    }))
  } catch (error) {
    if (error instanceof IntegrationUnavailableError && error.retryable) throw error
    await useDatabase().update(calendarConnections).set({
      status: 'needs_reauthorization',
      lastError: 'Microsoft authorization expired.',
      lastCheckedAt: sql`now()`,
      updatedAt: sql`now()`
    }).where(and(
      eq(calendarConnections.id, connection.id),
      eq(calendarConnections.refreshTokenEncrypted, connection.refreshTokenEncrypted)
    ))
    throw new MicrosoftCalendarUnavailableError('Microsoft Calendar needs to be reconnected.', {
      retryable: false,
      cause: error
    })
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)
  const nextRefreshToken = tokens.refresh_token
    ? encryptCredential(tokens.refresh_token)
    : connection.refreshTokenEncrypted
  const [updated] = await useDatabase().update(calendarConnections).set({
    accessTokenEncrypted: encryptCredential(tokens.access_token),
    refreshTokenEncrypted: nextRefreshToken,
    accessTokenExpiresAt: expiresAt,
    scope: tokens.scope ?? connection.scope,
    lastError: null,
    lastCheckedAt: sql`now()`,
    updatedAt: sql`now()`
  }).where(and(
    eq(calendarConnections.id, connection.id),
    eq(calendarConnections.refreshTokenEncrypted, connection.refreshTokenEncrypted)
  )).returning({ id: calendarConnections.id })

  if (!updated) {
    const latest = await microsoftConnectionFor(userId)
    if (latest?.status === 'active' && latest.refreshTokenEncrypted !== connection.refreshTokenEncrypted) {
      return { connection: latest, token: decryptCredential(latest.accessTokenEncrypted) }
    }
    throw new MicrosoftCalendarUnavailableError('Microsoft credentials changed while refreshing. Please try again.')
  }

  return {
    connection: { ...connection, accessTokenExpiresAt: expiresAt, refreshTokenEncrypted: nextRefreshToken },
    token: tokens.access_token
  }
}

function graphUrl(path: string) {
  const url = path.startsWith('http') ? new URL(path) : new URL(`${GRAPH_BASE}${path}`)
  if (url.origin !== GRAPH_ORIGIN) {
    throw new MicrosoftCalendarUnavailableError('Microsoft returned an invalid continuation URL.', { retryable: false })
  }
  return url
}

async function graphResponse(userId: string, path: string, init: RequestInit = {}) {
  let auth = await accessToken(userId)
  if (!auth) {
    throw new MicrosoftCalendarUnavailableError('Microsoft Calendar is not connected.', { retryable: false })
  }
  const request = (token: string) => fetchWithTimeout(graphUrl(path), {
    ...init,
    headers: {
      'authorization': `Bearer ${token}`,
      'content-type': 'application/json',
      ...init.headers
    }
  })

  let response = await request(auth.token)
  if (response.status === 401) {
    auth = await accessToken(userId, true)
    if (!auth) {
      throw new MicrosoftCalendarUnavailableError('Microsoft Calendar is not connected.', { retryable: false })
    }
    response = await request(auth.token)
  }

  if (!response.ok && response.status !== 404) {
    const message = `Microsoft Calendar request failed (${response.status}).`
    await useDatabase().update(calendarConnections).set({
      lastError: message,
      lastCheckedAt: sql`now()`,
      updatedAt: sql`now()`
    }).where(eq(calendarConnections.id, auth.connection.id))
    throw new MicrosoftCalendarUnavailableError(message, {
      retryable: response.status === 429 || response.status >= 500,
      retryAfterMs: retryAfterMilliseconds(response)
    })
  }
  return response
}

async function graphRequest<T>(userId: string, path: string, init?: RequestInit): Promise<T> {
  const response = await graphResponse(userId, path, init)
  if (!response.ok) {
    throw new MicrosoftCalendarUnavailableError(`Microsoft Calendar request failed (${response.status}).`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function saveMicrosoftConnection(userId: string, tokens: MicrosoftTokens) {
  if (!tokens.refresh_token) {
    throw new MicrosoftCalendarUnavailableError('Microsoft did not provide offline access. Please connect again.', {
      retryable: false
    })
  }
  const profileResponse = await fetchWithTimeout(`${GRAPH_BASE}/me?$select=id,displayName,mail,userPrincipalName`, {
    headers: { authorization: `Bearer ${tokens.access_token}` }
  })
  if (!profileResponse.ok) {
    throw new MicrosoftCalendarUnavailableError('Microsoft account details could not be loaded.')
  }
  const profile = await profileResponse.json() as MicrosoftUser
  const accountLabel = profile.mail ?? profile.userPrincipalName ?? profile.displayName ?? 'Microsoft account'
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)

  await useDatabase().insert(calendarConnections).values({
    userId,
    provider: 'microsoft',
    accountLabel,
    accessTokenEncrypted: encryptCredential(tokens.access_token),
    refreshTokenEncrypted: encryptCredential(tokens.refresh_token),
    accessTokenExpiresAt: expiresAt,
    scope: tokens.scope ?? MICROSOFT_CALENDAR_SCOPES.join(' '),
    status: 'active',
    lastError: null,
    lastCheckedAt: sql`now()`
  }).onConflictDoUpdate({
    target: [calendarConnections.userId, calendarConnections.provider],
    set: {
      accountLabel,
      accessTokenEncrypted: encryptCredential(tokens.access_token),
      refreshTokenEncrypted: encryptCredential(tokens.refresh_token),
      accessTokenExpiresAt: expiresAt,
      scope: tokens.scope ?? MICROSOFT_CALENDAR_SCOPES.join(' '),
      status: 'active',
      lastError: null,
      lastCheckedAt: sql`now()`,
      updatedAt: sql`now()`
    }
  })
}

function mapCalendar(calendar: MicrosoftCalendar): MicrosoftCalendarItem {
  return {
    id: calendar.id,
    summary: calendar.name,
    primary: Boolean(calendar.isDefaultCalendar),
    accessRole: calendar.canEdit
      ? calendar.isDefaultCalendar ? 'owner' : 'writer'
      : 'reader',
    backgroundColor: calendar.hexColor || undefined,
    shared: Boolean(calendar.isShared || calendar.isSharedWithMe),
    owner: calendar.owner?.address ?? calendar.owner?.name
  }
}

export async function listMicrosoftCalendars(userId: string) {
  const calendars: MicrosoftCalendarItem[] = []
  let next: string | undefined = '/me/calendars?$select=id,name,isDefaultCalendar,canEdit,hexColor,isShared,isSharedWithMe,owner&$top=100'
  while (next) {
    const page: GraphPage<MicrosoftCalendar> = await graphRequest<GraphPage<MicrosoftCalendar>>(userId, next)
    calendars.push(...(page.value ?? []).map(mapCalendar))
    next = page['@odata.nextLink']
  }
  await useDatabase().update(calendarConnections).set({
    lastCheckedAt: sql`now()`,
    lastError: null,
    updatedAt: sql`now()`
  }).where(and(
    eq(calendarConnections.userId, userId),
    eq(calendarConnections.provider, 'microsoft')
  ))
  return calendars
}

export async function initializeMicrosoftCalendars(userId: string) {
  const calendars = await listMicrosoftCalendars(userId)
  const primary = calendars.find(calendar => calendar.primary) ?? calendars[0]
  if (!primary) throw new MicrosoftCalendarUnavailableError('No Microsoft calendars were found.')
  const writable = [primary, ...calendars].find(calendar => ['writer', 'owner'].includes(calendar.accessRole))
  const [otherDestination] = await useDatabase().select({ id: calendarConnections.id })
    .from(calendarConnections)
    .where(and(
      eq(calendarConnections.userId, userId),
      ne(calendarConnections.provider, 'microsoft'),
      isNotNull(calendarConnections.writeCalendarId)
    )).limit(1)

  await useDatabase().update(calendarConnections).set({
    conflictCalendarIds: [primary.id],
    writeCalendarId: otherDestination ? null : writable?.id ?? null,
    lastCheckedAt: sql`now()`,
    updatedAt: sql`now()`
  }).where(and(
    eq(calendarConnections.userId, userId),
    eq(calendarConnections.provider, 'microsoft')
  ))
}

function utcDateTime(value: string | undefined) {
  if (!value) return null
  return /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`
}

async function calendarBusyPeriods(userId: string, calendarId: string, from: string, to: string) {
  const periods: BusyPeriod[] = []
  const query = new URLSearchParams({
    startDateTime: from,
    endDateTime: to,
    $select: 'id,start,end,showAs,isCancelled',
    $top: '1000'
  })
  let next: string | undefined = `/me/calendars/${encodeURIComponent(calendarId)}/calendarView?${query}`
  while (next) {
    const page: GraphPage<MicrosoftEvent> = await graphRequest<GraphPage<MicrosoftEvent>>(userId, next, {
      headers: { prefer: 'outlook.timezone="UTC"' }
    })
    for (const event of page.value ?? []) {
      if (event.isCancelled || event.showAs === 'free') continue
      const start = utcDateTime(event.start?.dateTime)
      const end = utcDateTime(event.end?.dateTime)
      if (start && end) periods.push({ start, end })
    }
    next = page['@odata.nextLink']
  }
  return periods
}

async function busyPeriodsForCalendars(userId: string, calendarIds: string[], from: string, to: string) {
  const periods: BusyPeriod[] = []
  // Bound concurrency to avoid turning a user with many shared calendars into
  // a burst of Graph requests that is immediately throttled.
  for (let index = 0; index < calendarIds.length; index += 4) {
    const chunk = calendarIds.slice(index, index + 4)
    const results = await Promise.all(chunk.map(id => calendarBusyPeriods(userId, id, from, to)))
    periods.push(...results.flat())
  }
  return periods
}

export async function microsoftBusyTimes(userId: string, from: string, to: string) {
  const connection = await microsoftConnectionFor(userId)
  if (!connection) return []
  if (connection.status !== 'active') {
    throw new MicrosoftCalendarUnavailableError('Microsoft Calendar needs to be reconnected.', { retryable: false })
  }
  if (!connection.conflictCalendarIds.length) return []

  const requestedFrom = Date.parse(from)
  const requestedTo = Date.parse(to)
  const cacheKey = `${connection.id}:${connection.updatedAt.toISOString()}:${connection.conflictCalendarIds.join('\u0000')}`
  const cached = busyCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now() && requestedFrom >= cached.from && requestedTo <= cached.to) {
    return (await cached.request).filter(period => Date.parse(period.end) > requestedFrom && Date.parse(period.start) < requestedTo)
  }

  const request = busyPeriodsForCalendars(userId, connection.conflictCalendarIds, from, to)
  if (busyCache.size >= 1000) {
    const oldestKey = busyCache.keys().next().value
    if (oldestKey) busyCache.delete(oldestKey)
  }
  busyCache.set(cacheKey, {
    from: requestedFrom,
    to: requestedTo,
    expiresAt: Date.now() + BUSY_CACHE_MS,
    request
  })

  try {
    return await request
  } catch (error) {
    busyCache.delete(cacheKey)
    throw error
  }
}

export async function microsoftCalendarConnection(userId: string) {
  const connection = await microsoftConnectionFor(userId)
  const configured = Boolean(useEnv().microsoftClientId && useEnv().microsoftClientSecret)
  if (!connection) return { connected: false as const, configured }
  return {
    connected: connection.status === 'active',
    configured,
    status: connection.status,
    accountLabel: connection.accountLabel,
    conflictCalendarIds: connection.conflictCalendarIds,
    writeCalendarId: connection.writeCalendarId,
    lastError: connection.lastError,
    lastCheckedAt: connection.lastCheckedAt?.toISOString() ?? null
  }
}

export async function updateMicrosoftCalendarSelection(
  userId: string,
  conflictCalendarIds: string[],
  writeCalendarId: string | null
) {
  const calendars = await listMicrosoftCalendars(userId)
  const byId = new Map(calendars.map(calendar => [calendar.id, calendar]))
  if (conflictCalendarIds.some(id => !byId.has(id))) {
    throw new MicrosoftCalendarSelectionError('Choose calendars from your connected Microsoft account.')
  }
  if (writeCalendarId) {
    const write = byId.get(writeCalendarId)
    if (!write || !['writer', 'owner'].includes(write.accessRole)) {
      throw new MicrosoftCalendarSelectionError('Choose a Microsoft calendar where Schedra may create events.')
    }
  }

  const checkFrom = new Date()
  const checkTo = new Date(checkFrom.getTime() + 60 * 60_000)
  await busyPeriodsForCalendars(
    userId,
    conflictCalendarIds,
    checkFrom.toISOString(),
    checkTo.toISOString()
  )

  await useDatabase().transaction(async (tx) => {
    if (writeCalendarId) {
      await tx.update(calendarConnections).set({
        writeCalendarId: null,
        updatedAt: sql`now()`
      }).where(and(
        eq(calendarConnections.userId, userId),
        ne(calendarConnections.provider, 'microsoft'),
        isNotNull(calendarConnections.writeCalendarId)
      ))
    }
    await tx.update(calendarConnections).set({
      conflictCalendarIds,
      writeCalendarId,
      lastCheckedAt: sql`now()`,
      lastError: null,
      updatedAt: sql`now()`
    }).where(and(
      eq(calendarConnections.userId, userId),
      eq(calendarConnections.provider, 'microsoft')
    ))
  })
}

function eventDescription(input: CalendarEventInput) {
  const location = input.locationType === 'google_meet'
    ? 'Google Meet'
    : input.locationType === 'zoom' ? 'Zoom' : input.locationDetails
  return [
    input.description,
    `Guest: ${input.attendeeName} (${input.attendeeEmail})`,
    `Where: ${location}`,
    input.meetingUrl ? `Join: ${input.meetingUrl}` : null,
    input.notes ? `Guest notes:\n${input.notes}` : null,
    `Manage this booking: ${useEnv().schedraUrl}/booking/${input.uid}`
  ].filter(Boolean).join('\n\n').slice(0, 10000)
}

function transactionId(value: string) {
  const hash = createHash('sha256').update(value).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

function eventBody(input: CalendarEventInput, includeTransactionId: boolean) {
  const generatedMeeting = ['google_meet', 'zoom'].includes(input.locationType)
  const location = generatedMeeting
    ? input.meetingUrl ?? (input.locationType === 'zoom' ? 'Zoom' : 'Google Meet')
    : input.locationDetails
  return {
    subject: `${input.title} with ${input.attendeeName}`.slice(0, 255),
    body: { contentType: 'text', content: eventDescription(input) },
    start: { dateTime: input.startsAt.toISOString().replace(/Z$/, ''), timeZone: 'UTC' },
    end: { dateTime: input.endsAt.toISOString().replace(/Z$/, ''), timeZone: 'UTC' },
    location: { displayName: location },
    attendees: input.inviteGuests === false
      ? []
      : [
          { emailAddress: { address: input.attendeeEmail, name: input.attendeeName }, type: 'required' },
          ...input.additionalGuestEmails.map(address => ({
            emailAddress: { address },
            type: 'required'
          }))
        ],
    responseRequested: input.inviteGuests !== false,
    allowNewTimeProposals: false,
    showAs: 'busy',
    ...includeTransactionId
      ? { transactionId: transactionId(`schedra:${input.calendarEventKey ?? input.uid}`) }
      : {}
  }
}

export function microsoftEventId(uid: string) {
  return transactionId(`schedra:${uid}`)
}

export async function upsertMicrosoftCalendarEvent(
  userId: string,
  calendarId: string,
  eventId: string | null,
  input: CalendarEventInput
) {
  const calendar = encodeURIComponent(calendarId)
  if (eventId) {
    const response = await graphResponse(
      userId,
      `/me/calendars/${calendar}/events/${encodeURIComponent(eventId)}`,
      { method: 'PATCH', body: JSON.stringify(eventBody(input, false)) }
    )
    if (response.ok) {
      const event = await response.json() as MicrosoftEvent
      return { id: event.id || eventId, meetingUrl: null }
    }
  }

  const event = await graphRequest<MicrosoftEvent>(userId, `/me/calendars/${calendar}/events`, {
    method: 'POST',
    body: JSON.stringify(eventBody(input, true))
  })
  return { id: event.id, meetingUrl: null }
}

export async function deleteMicrosoftCalendarEvent(userId: string, calendarId: string, eventId: string) {
  const response = await graphResponse(
    userId,
    `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE' }
  )
  if (!response.ok && response.status !== 404) {
    throw new MicrosoftCalendarUnavailableError(`Microsoft Calendar request failed (${response.status}).`)
  }
}

export async function disconnectMicrosoftCalendar(userId: string) {
  await useDatabase().delete(calendarConnections).where(and(
    eq(calendarConnections.userId, userId),
    eq(calendarConnections.provider, 'microsoft')
  ))
}
