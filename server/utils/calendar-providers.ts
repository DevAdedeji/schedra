import type { CalendarProvider } from './calendar-provider'
import {
  deleteGoogleCalendarEvent,
  googleBusyTimes,
  googleConnectionFor,
  googleEventId,
  upsertGoogleCalendarEvent
} from './google-calendar'

const googleProvider: CalendarProvider = {
  id: 'google',
  busyTimes: googleBusyTimes,
  connectionFor: googleConnectionFor,
  eventId: googleEventId,
  upsertEvent: upsertGoogleCalendarEvent,
  deleteEvent: deleteGoogleCalendarEvent
}

const providers = new Map<string, CalendarProvider>([[googleProvider.id, googleProvider]])

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

export async function calendarBusyTimes(userId: string, from: string, to: string) {
  const connected = await connectedCalendarProviders(userId)
  const periods = await Promise.all(connected.map(({ provider }) => provider.busyTimes(userId, from, to)))
  return periods.flat()
}
