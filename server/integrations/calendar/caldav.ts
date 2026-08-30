import { and, eq, sql } from 'drizzle-orm'
import { useDatabase } from '../../database'
import { calendarConnections, users } from '../../database/schema'
import { ensureDefaultCalendarDestination } from '../../repositories/calendar-connection'
import { IntegrationUnavailableError } from '../errors'
import { decryptCredential, encryptCredential } from './credential-crypto'
import type { CalendarEventInput } from './provider'
import {
  appleBusyTimes as fetchAppleBusyTimes,
  appleEventId,
  CalDavClientError,
  deleteAppleCalendarEvent as deleteRemoteAppleEvent,
  discoverAppleCalendars,
  upsertAppleCalendarEvent as upsertRemoteAppleEvent,
  type CalDavCredentials
} from './caldav-client'

const NON_EXPIRING_CREDENTIAL = new Date('9999-12-31T23:59:59.999Z')
const BUSY_CACHE_MS = 15_000

interface BusyCacheEntry {
  from: number
  to: number
  expiresAt: number
  request: Promise<Array<{ start: string, end: string }>>
}

const busyCache = new Map<string, BusyCacheEntry>()

export class AppleCalendarUnavailableError extends IntegrationUnavailableError {
  constructor(message: string, options: { retryable?: boolean, retryAfterMs?: number, cause?: unknown } = {}) {
    super(message, { provider: 'caldav', ...options })
    this.name = 'AppleCalendarUnavailableError'
  }
}

export class AppleCalendarSelectionError extends Error {}

function providerError(error: unknown) {
  if (error instanceof AppleCalendarUnavailableError) return error
  if (error instanceof CalDavClientError) {
    return new AppleCalendarUnavailableError(error.message, {
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs,
      cause: error
    })
  }
  return new AppleCalendarUnavailableError('Apple Calendar is temporarily unavailable.', { cause: error })
}

export async function appleConnectionFor(userId: string) {
  const [connection] = await useDatabase().select().from(calendarConnections)
    .where(and(
      eq(calendarConnections.userId, userId),
      eq(calendarConnections.provider, 'caldav')
    )).limit(1)
  return connection ?? null
}

function connectionCredentials(connection: NonNullable<Awaited<ReturnType<typeof appleConnectionFor>>>): CalDavCredentials {
  return {
    username: decryptCredential(connection.accessTokenEncrypted),
    password: decryptCredential(connection.refreshTokenEncrypted)
  }
}

async function activeConnection(userId: string) {
  const connection = await appleConnectionFor(userId)
  if (!connection) {
    throw new AppleCalendarUnavailableError('Apple Calendar is not connected.', { retryable: false })
  }
  if (connection.status !== 'active') {
    throw new AppleCalendarUnavailableError('Apple Calendar needs to be reconnected.', { retryable: false })
  }
  return connection
}

async function accountTimeZone(userId: string) {
  const [user] = await useDatabase().select({ timeZone: users.timeZone })
    .from(users).where(eq(users.id, userId)).limit(1)
  return user?.timeZone ?? 'UTC'
}

async function recordFailure(
  connection: NonNullable<Awaited<ReturnType<typeof appleConnectionFor>>>,
  error: unknown
): Promise<never> {
  const clientError = error instanceof CalDavClientError ? error : null
  const message = clientError?.message ?? 'Apple Calendar is temporarily unavailable.'
  await useDatabase().update(calendarConnections).set({
    ...(clientError?.authenticationFailure ? { status: 'needs_reauthorization' as const } : {}),
    lastError: message,
    lastCheckedAt: sql`now()`,
    updatedAt: sql`now()`
  }).where(eq(calendarConnections.id, connection.id))
  throw providerError(error)
}

export async function connectAppleCalendar(userId: string, credentials: CalDavCredentials) {
  let calendars
  try {
    calendars = await discoverAppleCalendars(credentials)
  } catch (error) {
    throw providerError(error)
  }
  const primary = calendars.find(calendar => calendar.primary) ?? calendars[0]!
  const writable = [primary, ...calendars].find(calendar => ['writer', 'owner'].includes(calendar.accessRole))
  const [defaultDestination] = await useDatabase().select({ id: calendarConnections.id })
    .from(calendarConnections)
    .where(and(
      eq(calendarConnections.userId, userId),
      eq(calendarConnections.isDefaultWriteDestination, true)
    )).limit(1)

  await useDatabase().insert(calendarConnections).values({
    userId,
    provider: 'caldav',
    accountLabel: credentials.username,
    accessTokenEncrypted: encryptCredential(credentials.username),
    refreshTokenEncrypted: encryptCredential(credentials.password),
    accessTokenExpiresAt: NON_EXPIRING_CREDENTIAL,
    scope: 'apple-caldav',
    conflictCalendarIds: [primary.id],
    writeCalendarId: writable?.id ?? null,
    isDefaultWriteDestination: !defaultDestination,
    status: 'active',
    preferencesConfiguredAt: null,
    lastError: null,
    lastCheckedAt: sql`now()`
  }).onConflictDoUpdate({
    target: [calendarConnections.userId, calendarConnections.provider],
    set: {
      accountLabel: credentials.username,
      accessTokenEncrypted: encryptCredential(credentials.username),
      refreshTokenEncrypted: encryptCredential(credentials.password),
      accessTokenExpiresAt: NON_EXPIRING_CREDENTIAL,
      scope: 'apple-caldav',
      conflictCalendarIds: [primary.id],
      writeCalendarId: writable?.id ?? null,
      status: 'active',
      preferencesConfiguredAt: null,
      lastError: null,
      lastCheckedAt: sql`now()`,
      updatedAt: sql`now()`
    }
  })
}

export async function listAppleCalendars(userId: string) {
  const connection = await activeConnection(userId)
  try {
    const calendars = await discoverAppleCalendars(connectionCredentials(connection))
    await useDatabase().update(calendarConnections).set({
      lastError: null,
      lastCheckedAt: sql`now()`,
      updatedAt: sql`now()`
    }).where(eq(calendarConnections.id, connection.id))
    return calendars
  } catch (error) {
    return recordFailure(connection, error)
  }
}

export async function appleCalendarConnection(userId: string) {
  const connection = await appleConnectionFor(userId)
  if (!connection) return { connected: false as const, configured: true }
  return {
    connected: connection.status === 'active',
    configured: true,
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

export async function updateAppleCalendarSelection(
  userId: string,
  conflictCalendarIds: string[],
  writeCalendarId: string,
  defaultForBookings = false
) {
  const calendars = await listAppleCalendars(userId)
  const byId = new Map(calendars.map(calendar => [calendar.id, calendar]))
  if (conflictCalendarIds.some(id => !byId.has(id))) {
    throw new AppleCalendarSelectionError('Choose calendars from your connected Apple account.')
  }
  const write = byId.get(writeCalendarId)
  if (!write || !['writer', 'owner'].includes(write.accessRole)) {
    throw new AppleCalendarSelectionError('Choose an Apple calendar where Schedra may create events.')
  }

  const connection = await activeConnection(userId)
  try {
    await fetchAppleBusyTimes(
      connectionCredentials(connection),
      conflictCalendarIds,
      new Date().toISOString(),
      new Date(Date.now() + 60 * 60_000).toISOString(),
      await accountTimeZone(userId)
    )
  } catch (error) {
    await recordFailure(connection, error)
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
      lastCheckedAt: sql`now()`,
      lastError: null,
      updatedAt: sql`now()`
    }).where(eq(calendarConnections.id, connection.id))
  })
}

export function clearAppleBusyCache() {
  busyCache.clear()
}

export async function appleBusyTimes(userId: string, from: string, to: string) {
  const connection = await appleConnectionFor(userId)
  if (!connection) return []
  if (connection.status !== 'active') {
    throw new AppleCalendarUnavailableError('Apple Calendar needs to be reconnected.', { retryable: false })
  }
  if (!connection.conflictCalendarIds.length) return []

  const requestedFrom = Date.parse(from)
  const requestedTo = Date.parse(to)
  const cacheKey = `${connection.id}:${connection.updatedAt.toISOString()}:${connection.conflictCalendarIds.join('\u0000')}`
  const cached = busyCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now() && requestedFrom >= cached.from && requestedTo <= cached.to) {
    return (await cached.request).filter(period =>
      Date.parse(period.end) > requestedFrom && Date.parse(period.start) < requestedTo)
  }

  const request = fetchAppleBusyTimes(
    connectionCredentials(connection),
    connection.conflictCalendarIds,
    from,
    to,
    await accountTimeZone(userId)
  ).catch(async error => recordFailure(connection, error))
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

export async function upsertAppleCalendarEvent(
  userId: string,
  calendarId: string,
  eventId: string | null,
  input: CalendarEventInput
) {
  const connection = await activeConnection(userId)
  try {
    return await upsertRemoteAppleEvent(
      connectionCredentials(connection),
      calendarId,
      eventId,
      input
    )
  } catch (error) {
    return recordFailure(connection, error)
  }
}

export async function deleteAppleCalendarEvent(userId: string, calendarId: string, eventId: string) {
  const connection = await activeConnection(userId)
  try {
    await deleteRemoteAppleEvent(connectionCredentials(connection), calendarId, eventId)
  } catch (error) {
    await recordFailure(connection, error)
  }
}

export async function disconnectAppleCalendar(userId: string) {
  await useDatabase().delete(calendarConnections).where(and(
    eq(calendarConnections.userId, userId),
    eq(calendarConnections.provider, 'caldav')
  ))
  await ensureDefaultCalendarDestination(userId)
}

export { appleEventId }
