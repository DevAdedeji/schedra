import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
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

/** Users whose selected Microsoft destination can create Teams-enabled events. */
export async function writableMicrosoftTeamsCalendarUserIds(userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds)]
  if (!uniqueUserIds.length) return []

  const rows = await useDatabase()
    .select({ userId: calendarConnections.userId })
    .from(calendarConnections)
    .where(and(
      inArray(calendarConnections.userId, uniqueUserIds),
      eq(calendarConnections.provider, 'microsoft'),
      eq(calendarConnections.status, 'active'),
      eq(calendarConnections.supportsMicrosoftTeams, true),
      isNotNull(calendarConnections.writeCalendarId)
    ))

  return [...new Set(rows.map(row => row.userId))]
}

/** Keep the default explicit after its provider is disconnected. */
export async function ensureDefaultCalendarDestination(userId: string) {
  const db = useDatabase()
  const [current] = await db.select({ id: calendarConnections.id })
    .from(calendarConnections)
    .where(and(
      eq(calendarConnections.userId, userId),
      eq(calendarConnections.isDefaultWriteDestination, true),
      eq(calendarConnections.status, 'active'),
      isNotNull(calendarConnections.writeCalendarId)
    ))
    .limit(1)
  if (current) return

  const [fallback] = await db.select({ id: calendarConnections.id })
    .from(calendarConnections)
    .where(and(
      eq(calendarConnections.userId, userId),
      eq(calendarConnections.status, 'active'),
      isNotNull(calendarConnections.writeCalendarId)
    ))
    .orderBy(asc(calendarConnections.provider))
    .limit(1)
  if (!fallback) return

  await db.transaction(async (tx) => {
    await tx.update(calendarConnections).set({
      isDefaultWriteDestination: false,
      updatedAt: sql`now()`
    }).where(eq(calendarConnections.userId, userId))
    await tx.update(calendarConnections).set({
      isDefaultWriteDestination: true,
      updatedAt: sql`now()`
    }).where(eq(calendarConnections.id, fallback.id))
  })
}
