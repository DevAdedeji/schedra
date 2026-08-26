import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { calendarConnections } from '../database/schema'
import { useDatabase } from '../database'

/** Persistence queries for calendar-connection policy checks. */
export async function writableGoogleCalendarUserIds(userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds)]
  if (!uniqueUserIds.length) return []

  const rows = await useDatabase()
    .select({ userId: calendarConnections.userId })
    .from(calendarConnections)
    .where(and(
      inArray(calendarConnections.userId, uniqueUserIds),
      eq(calendarConnections.provider, 'google'),
      eq(calendarConnections.status, 'active'),
      isNotNull(calendarConnections.writeCalendarId)
    ))

  return [...new Set(rows.map(row => row.userId))]
}
