import { and, eq, inArray } from 'drizzle-orm'
import { videoConferenceConnections } from '../database/schema'
import { useDatabase } from '../database'

/** Persistence queries used by event-location policy checks. */
export async function connectedZoomUserIds(userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds)]
  if (!uniqueUserIds.length) return []

  const rows = await useDatabase()
    .select({ userId: videoConferenceConnections.userId })
    .from(videoConferenceConnections)
    .where(and(
      inArray(videoConferenceConnections.userId, uniqueUserIds),
      eq(videoConferenceConnections.provider, 'zoom'),
      eq(videoConferenceConnections.status, 'active')
    ))

  return [...new Set(rows.map(row => row.userId))]
}
