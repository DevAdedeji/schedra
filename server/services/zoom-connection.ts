import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  bookingConferenceMeetings,
  bookings,
  videoConferenceConnections
} from '../database/schema'
import { useDatabase } from '../database'

interface ZoomConnectionIdentity {
  id: string
  userId: string
}

/**
 * Deletes locally held Zoom data without requiring a working Zoom token.
 * This is shared by Schedra's disconnect action and Zoom's deauthorization
 * webhook, where the access token has already been revoked upstream.
 */
export async function deleteZoomConnectionData(connection: ZoomConnectionIdentity) {
  const db = useDatabase()
  return db.transaction(async (tx) => {
    const meetings = await tx
      .select({ bookingId: bookingConferenceMeetings.bookingId })
      .from(bookingConferenceMeetings)
      .where(and(
        eq(bookingConferenceMeetings.userId, connection.userId),
        eq(bookingConferenceMeetings.provider, 'zoom')
      ))

    const bookingIds = [...new Set(meetings.map(meeting => meeting.bookingId))]
    if (bookingIds.length) {
      await tx.update(bookings).set({
        meetingUrl: null,
        updatedAt: sql`now()`
      }).where(and(
        inArray(bookings.id, bookingIds),
        eq(bookings.locationType, 'zoom')
      ))
    }

    await tx.delete(bookingConferenceMeetings).where(and(
      eq(bookingConferenceMeetings.userId, connection.userId),
      eq(bookingConferenceMeetings.provider, 'zoom')
    ))
    await tx.delete(videoConferenceConnections).where(eq(videoConferenceConnections.id, connection.id))

    return { removedMeetings: bookingIds.length }
  })
}

/** Idempotently removes every local install matching the Zoom user. */
export async function deauthorizeZoomUser(providerAccountId: string) {
  const connections = await useDatabase()
    .select({
      id: videoConferenceConnections.id,
      userId: videoConferenceConnections.userId
    })
    .from(videoConferenceConnections)
    .where(and(
      eq(videoConferenceConnections.provider, 'zoom'),
      eq(videoConferenceConnections.providerAccountId, providerAccountId)
    ))

  let removedMeetings = 0
  for (const connection of connections) {
    const removed = await deleteZoomConnectionData(connection)
    removedMeetings += removed.removedMeetings
  }

  return { removedConnections: connections.length, removedMeetings }
}
