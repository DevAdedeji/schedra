import type { CalendarProvider } from './provider'
import {
  deleteGoogleCalendarEvent,
  googleBusyTimes,
  googleConnectionFor,
  googleEventId,
  upsertGoogleCalendarEvent
} from './google'
import {
  deleteMicrosoftCalendarEvent,
  microsoftBusyTimes,
  microsoftConnectionFor,
  microsoftEventId,
  upsertMicrosoftCalendarEvent
} from './microsoft'

const googleProvider: CalendarProvider = {
  id: 'google',
  busyTimes: googleBusyTimes,
  connectionFor: googleConnectionFor,
  eventId: googleEventId,
  upsertEvent: upsertGoogleCalendarEvent,
  deleteEvent: deleteGoogleCalendarEvent
}

const microsoftProvider: CalendarProvider = {
  id: 'microsoft',
  busyTimes: microsoftBusyTimes,
  connectionFor: microsoftConnectionFor,
  eventId: microsoftEventId,
  upsertEvent: upsertMicrosoftCalendarEvent,
  deleteEvent: deleteMicrosoftCalendarEvent
}

const providers = new Map<string, CalendarProvider>([
  [googleProvider.id, googleProvider],
  [microsoftProvider.id, microsoftProvider]
])

export function calendarProvider(id: string) {
  return providers.get(id) ?? null
}

export async function connectedCalendarProviders(userId: string) {
  const connections = await Promise.all([...providers.values()].map(async provider => ({
    provider,
    connection: await provider.connectionFor(userId)
  })))
  return connections.filter((entry): entry is { provider: CalendarProvider, connection: NonNullable<typeof entry.connection> } => Boolean(entry.connection))
}

export async function calendarDestinationProvider(userId: string, preferredProvider?: 'google' | 'microsoft' | null) {
  const connected = await connectedCalendarProviders(userId)
  const writable = connected.filter(entry =>
    entry.connection.status === 'active' && Boolean(entry.connection.writeCalendarId))
  if (preferredProvider) {
    return writable.find(entry => entry.provider.id === preferredProvider) ?? null
  }
  return writable.find(entry => entry.connection.isDefaultWriteDestination) ?? writable[0] ?? null
}

export function calendarProviderForLocation(locationType: string) {
  if (locationType === 'google_meet') return 'google' as const
  if (locationType === 'microsoft_teams') return 'microsoft' as const
  return null
}

export async function calendarBusyTimes(userId: string, from: string, to: string) {
  const connected = await connectedCalendarProviders(userId)
  const periods = await Promise.all(connected.map(({ provider }) => provider.busyTimes(userId, from, to)))
  return periods.flat()
}
