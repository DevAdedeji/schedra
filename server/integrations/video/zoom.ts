import { and, eq, sql } from 'drizzle-orm'
import { videoConferenceConnections } from '../../database/schema'
import { useDatabase } from '../../database'
import { useEnv } from '../../config/env'
import { fetchWithTimeout } from '../fetch'
import { decryptCredential, encryptCredential } from '../calendar/credential-crypto'
import { deleteZoomConnectionData } from '../../services/zoom-connection'
import { IntegrationUnavailableError, retryAfterMilliseconds } from '../errors'

interface ZoomTokens {
  access_token: string
  refresh_token: string
  expires_in: number
  scope?: string
}

interface ZoomUser {
  id: string
  email?: string
  first_name?: string
  last_name?: string
}

interface ZoomMeeting {
  id: number | string
  join_url: string
  agenda?: string
}

interface ZoomMeetingPage {
  meetings?: ZoomMeeting[]
  next_page_token?: string
}

export interface ZoomMeetingInput {
  uid: string
  title: string
  description: string | null
  startsAt: Date
  endsAt: Date
  attendeeName: string
}

export class ZoomUnavailableError extends IntegrationUnavailableError {
  constructor(message: string, options: { retryable?: boolean, retryAfterMs?: number, cause?: unknown } = {}) {
    super(message, { provider: 'zoom', ...options })
    this.name = 'ZoomUnavailableError'
  }
}

function credentials() {
  const env = useEnv()
  if (!env.zoomClientId || !env.zoomClientSecret) {
    throw new ZoomUnavailableError('Zoom is not configured.')
  }
  return { env, basic: Buffer.from(`${env.zoomClientId}:${env.zoomClientSecret}`).toString('base64') }
}

export function zoomAuthorizationUrl(state: string) {
  const { env } = credentials()
  const url = new URL('https://zoom.us/oauth/authorize')
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: env.zoomClientId!,
    redirect_uri: `${env.schedraUrl}/api/integrations/zoom/callback`,
    state
  }).toString()
  return url.toString()
}

export async function exchangeZoomCode(code: string): Promise<ZoomTokens> {
  const { env, basic } = credentials()
  const url = new URL('https://zoom.us/oauth/token')
  url.search = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${env.schedraUrl}/api/integrations/zoom/callback`
  }).toString()
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}` }
  })
  if (!response.ok) throw new ZoomUnavailableError('Zoom did not complete the connection.')
  return response.json() as Promise<ZoomTokens>
}

export async function zoomConnectionFor(userId: string) {
  const [connection] = await useDatabase().select().from(videoConferenceConnections)
    .where(and(
      eq(videoConferenceConnections.userId, userId),
      eq(videoConferenceConnections.provider, 'zoom')
    )).limit(1)
  return connection ?? null
}

async function tokenRequest(tokens: ZoomTokens | { refresh_token: string }) {
  const { basic } = credentials()
  const url = new URL('https://zoom.us/oauth/token')
  url.search = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token
  }).toString()
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}` }
  })
  if (!response.ok) {
    throw new ZoomUnavailableError(
      response.status === 429 || response.status >= 500
        ? 'Zoom is temporarily unavailable.'
        : 'Zoom authorization has expired. Reconnect Zoom to continue.',
      {
        retryable: response.status === 429 || response.status >= 500,
        retryAfterMs: retryAfterMilliseconds(response)
      }
    )
  }
  return response.json() as Promise<ZoomTokens>
}

async function accessToken(userId: string, forceRefresh = false) {
  const connection = await zoomConnectionFor(userId)
  if (!connection) return null
  if (connection.status !== 'active') {
    throw new ZoomUnavailableError('Zoom needs to be reconnected.', { retryable: false })
  }
  if (!forceRefresh && connection.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
    return { connection, token: decryptCredential(connection.accessTokenEncrypted) }
  }

  try {
    // Zoom rotates refresh tokens. Persist both values from every refresh so an
    // older process can never overwrite the latest usable credential.
    const tokens = await tokenRequest({
      refresh_token: decryptCredential(connection.refreshTokenEncrypted)
    })
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)
    const [updated] = await useDatabase().update(videoConferenceConnections).set({
      accessTokenEncrypted: encryptCredential(tokens.access_token),
      refreshTokenEncrypted: encryptCredential(tokens.refresh_token),
      accessTokenExpiresAt: expiresAt,
      scope: tokens.scope ?? connection.scope,
      lastError: null,
      lastCheckedAt: sql`now()`,
      updatedAt: sql`now()`
    }).where(and(
      eq(videoConferenceConnections.id, connection.id),
      eq(videoConferenceConnections.refreshTokenEncrypted, connection.refreshTokenEncrypted)
    )).returning({ id: videoConferenceConnections.id })
    if (!updated) {
      const latest = await zoomConnectionFor(userId)
      if (latest?.status === 'active' && latest.refreshTokenEncrypted !== connection.refreshTokenEncrypted) {
        return { connection: latest, token: decryptCredential(latest.accessTokenEncrypted) }
      }
      throw new ZoomUnavailableError('Zoom credentials changed while refreshing. Please try again.')
    }
    return { connection: { ...connection, accessTokenExpiresAt: expiresAt }, token: tokens.access_token }
  } catch (error) {
    if (error instanceof IntegrationUnavailableError && error.retryable) throw error
    const latest = await zoomConnectionFor(userId)
    if (latest?.status === 'active' && latest.refreshTokenEncrypted !== connection.refreshTokenEncrypted) {
      return { connection: latest, token: decryptCredential(latest.accessTokenEncrypted) }
    }
    await useDatabase().update(videoConferenceConnections).set({
      status: 'needs_reauthorization',
      lastError: 'Zoom authorization expired.',
      updatedAt: sql`now()`
    }).where(and(
      eq(videoConferenceConnections.id, connection.id),
      eq(videoConferenceConnections.refreshTokenEncrypted, connection.refreshTokenEncrypted)
    ))
    throw new ZoomUnavailableError('Zoom authorization has expired. Reconnect Zoom to continue.', {
      retryable: false,
      cause: error
    })
  }
}

async function zoomResponse(userId: string, path: string, init: RequestInit = {}) {
  let auth = await accessToken(userId)
  if (!auth) throw new ZoomUnavailableError('Zoom is not connected.', { retryable: false })
  const request = (token: string) => fetchWithTimeout(`https://api.zoom.us/v2${path}`, {
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
    if (!auth) throw new ZoomUnavailableError('Zoom is not connected.', { retryable: false })
    response = await request(auth.token)
  }
  if (!response.ok && response.status !== 404) {
    const message = `Zoom request failed (${response.status}).`
    await useDatabase().update(videoConferenceConnections).set({
      lastError: message,
      lastCheckedAt: sql`now()`,
      updatedAt: sql`now()`
    }).where(eq(videoConferenceConnections.id, auth.connection.id))
    throw new ZoomUnavailableError(message, {
      retryable: response.status === 429 || response.status >= 500,
      retryAfterMs: retryAfterMilliseconds(response)
    })
  }
  return response
}

async function zoomRequest<T>(userId: string, path: string, init?: RequestInit): Promise<T> {
  const response = await zoomResponse(userId, path, init)
  if (!response.ok) throw new ZoomUnavailableError(`Zoom request failed (${response.status}).`)
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function saveZoomConnection(userId: string, tokens: ZoomTokens) {
  if (!tokens.refresh_token) throw new ZoomUnavailableError('Zoom did not provide offline access. Please connect again.')
  const profile = await fetchWithTimeout('https://api.zoom.us/v2/users/me', {
    headers: { authorization: `Bearer ${tokens.access_token}` }
  })
  if (!profile.ok) throw new ZoomUnavailableError('Zoom account details could not be loaded.')
  const user = await profile.json() as ZoomUser
  const accountLabel = user.email
    ?? [user.first_name, user.last_name].filter(Boolean).join(' ')
    ?? 'Zoom account'
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)

  await useDatabase().insert(videoConferenceConnections).values({
    userId,
    providerAccountId: user.id,
    accountLabel,
    accessTokenEncrypted: encryptCredential(tokens.access_token),
    refreshTokenEncrypted: encryptCredential(tokens.refresh_token),
    accessTokenExpiresAt: expiresAt,
    scope: tokens.scope ?? '',
    status: 'active',
    lastError: null,
    lastCheckedAt: sql`now()`
  }).onConflictDoUpdate({
    target: [videoConferenceConnections.userId, videoConferenceConnections.provider],
    set: {
      providerAccountId: user.id,
      accountLabel,
      accessTokenEncrypted: encryptCredential(tokens.access_token),
      refreshTokenEncrypted: encryptCredential(tokens.refresh_token),
      accessTokenExpiresAt: expiresAt,
      scope: tokens.scope ?? '',
      status: 'active',
      lastError: null,
      lastCheckedAt: sql`now()`,
      updatedAt: sql`now()`
    }
  })
}

export async function zoomConnection(userId: string) {
  const connection = await zoomConnectionFor(userId)
  const configured = Boolean(useEnv().zoomClientId && useEnv().zoomClientSecret)
  if (!connection) return { connected: false as const, configured }
  return {
    connected: connection.status === 'active',
    configured,
    status: connection.status,
    accountLabel: connection.accountLabel,
    lastError: connection.lastError,
    lastCheckedAt: connection.lastCheckedAt?.toISOString() ?? null
  }
}

export async function checkZoomConnection(userId: string) {
  await zoomRequest<ZoomUser>(userId, '/users/me')
  await useDatabase().update(videoConferenceConnections).set({
    lastError: null,
    lastCheckedAt: sql`now()`,
    updatedAt: sql`now()`
  }).where(and(
    eq(videoConferenceConnections.userId, userId),
    eq(videoConferenceConnections.provider, 'zoom')
  ))
  return zoomConnection(userId)
}

function marker(uid: string) {
  return `[Schedra:${uid}]`
}

function meetingBody(input: ZoomMeetingInput) {
  const agenda = [
    marker(input.uid),
    input.description,
    `Manage this booking: ${useEnv().schedraUrl}/booking/${input.uid}`
  ].filter(Boolean).join('\n\n').slice(0, 2000)

  return {
    topic: `${input.title} with ${input.attendeeName}`.slice(0, 200),
    type: 2,
    start_time: input.startsAt.toISOString(),
    duration: Math.max(1, Math.ceil((input.endsAt.getTime() - input.startsAt.getTime()) / 60_000)),
    timezone: 'UTC',
    agenda,
    settings: {
      approval_type: 2,
      join_before_host: false,
      waiting_room: true,
      mute_upon_entry: true,
      auto_recording: 'none'
    }
  }
}

async function findZoomMeeting(userId: string, uid: string) {
  let next = ''
  do {
    const query = new URLSearchParams({ type: 'scheduled', page_size: '100' })
    if (next) query.set('next_page_token', next)
    const page = await zoomRequest<ZoomMeetingPage>(userId, `/users/me/meetings?${query}`)
    const existing = page.meetings?.find(meeting => meeting.agenda?.startsWith(marker(uid)))
    if (existing) return existing
    next = page.next_page_token ?? ''
  } while (next)
  return null
}

export async function upsertZoomMeeting(userId: string, meetingId: string | null, input: ZoomMeetingInput) {
  const body = JSON.stringify(meetingBody(input))
  if (meetingId) {
    const response = await zoomResponse(userId, `/meetings/${encodeURIComponent(meetingId)}`, {
      method: 'PATCH',
      body
    })
    if (response.ok) return { id: meetingId, joinUrl: null as string | null }
  }

  // If a worker stopped after Zoom accepted the request but before Schedra
  // saved its mapping, recover the remote meeting instead of duplicating it.
  const existing = await findZoomMeeting(userId, input.uid)
  if (existing) return { id: String(existing.id), joinUrl: existing.join_url }

  const created = await zoomRequest<ZoomMeeting>(userId, '/users/me/meetings', {
    method: 'POST',
    body
  })
  return { id: String(created.id), joinUrl: created.join_url }
}

export async function deleteZoomMeeting(userId: string, meetingId: string) {
  const response = await zoomResponse(userId, `/meetings/${encodeURIComponent(meetingId)}`, { method: 'DELETE' })
  if (!response.ok && response.status !== 404) throw new ZoomUnavailableError(`Zoom request failed (${response.status}).`)
}

export async function disconnectZoom(userId: string) {
  const connection = await zoomConnectionFor(userId)
  if (!connection) return
  try {
    const { basic } = credentials()
    const url = new URL('https://zoom.us/oauth/revoke')
    url.searchParams.set('token', decryptCredential(connection.accessTokenEncrypted))
    await fetchWithTimeout(url, { method: 'POST', headers: { authorization: `Basic ${basic}` } })
  } catch {
    // Local disconnection must succeed even when Zoom cannot be reached.
  }
  await deleteZoomConnectionData(connection)
}
