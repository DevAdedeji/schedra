import { and, asc, eq, inArray, lt, lte, sql } from 'drizzle-orm'
import type { Database } from '../database/client'
import {
  bookingCalendarEvents,
  bookingConferenceMeetings,
  bookingHosts,
  bookings,
  calendarSyncJobs,
  eventTypes
} from '../database/schema'
import { useDatabase } from '../database'
import { connectedCalendarProviders } from '../integrations/calendar/providers'
import { bookingAnswersText } from '../domain/booking-answers'
import {
  deleteZoomMeeting,
  upsertZoomMeeting,
  zoomConnectionFor
} from '../integrations/video/zoom'

export type CalendarSyncExecutor = Pick<Database, 'insert'>
export type CalendarSyncAction = 'upsert' | 'delete'

export async function enqueueCalendarSync(
  bookingId: string,
  action: CalendarSyncAction,
  executor: CalendarSyncExecutor = useDatabase()
) {
  await executor.insert(calendarSyncJobs).values({
    bookingId,
    action,
    dedupeKey: `${action}:${bookingId}`
  }).onConflictDoNothing({ target: calendarSyncJobs.dedupeKey })
}

export async function enqueueFutureBookingsForCalendarSync(userId: string) {
  // One set-based statement handles both first-time connections and recovery:
  // existing jobs are reopened while bookings made before the integration was
  // installed receive their first durable job.
  await useDatabase().execute(sql`
    insert into calendar_sync_jobs (booking_id, action, dedupe_key)
    select distinct ${bookings.id}, 'upsert', 'upsert:' || ${bookings.id}::text
    from ${bookings}
    inner join ${bookingHosts} on ${bookingHosts.bookingId} = ${bookings.id}
    where ${bookingHosts.userId} = ${userId}
      and ${bookingHosts.releasedAt} is null
      and ${bookings.status} = 'confirmed'
      and ${bookings.endsAt} > now()
    on conflict (dedupe_key) do update set
      status = 'pending',
      attempts = 0,
      available_at = now(),
      locked_at = null,
      completed_at = null,
      last_error = null,
      updated_at = now()
  `)
}

async function syncBooking(bookingId: string, action: CalendarSyncAction) {
  const db = useDatabase()
  const [booking] = await db.select({
    id: bookings.id,
    uid: bookings.uid,
    status: bookings.status,
    hostId: bookings.hostId,
    startsAt: bookings.startsAt,
    endsAt: bookings.endsAt,
    attendeeName: bookings.attendeeName,
    attendeeEmail: bookings.attendeeEmail,
    additionalGuestEmails: bookings.additionalGuestEmails,
    answers: bookings.answers,
    locationType: bookings.locationType,
    locationDetails: bookings.locationDetails,
    meetingUrl: bookings.meetingUrl,
    eventTitle: eventTypes.title,
    eventDescription: eventTypes.description
  }).from(bookings)
    .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
    .where(eq(bookings.id, bookingId))
    .limit(1)

  if (!booking) return

  const [hosts, mappings, conferenceMappings] = await Promise.all([
    db.select({
      userId: bookingHosts.userId,
      isOrganizer: bookingHosts.isOrganizer
    }).from(bookingHosts)
      .where(eq(bookingHosts.bookingId, booking.id))
      .orderBy(sql`${bookingHosts.isOrganizer} desc`, bookingHosts.createdAt, bookingHosts.id),
    db.select().from(bookingCalendarEvents)
      .where(eq(bookingCalendarEvents.bookingId, booking.id)),
    db.select().from(bookingConferenceMeetings)
      .where(eq(bookingConferenceMeetings.bookingId, booking.id))
  ])

  const conferenceMapping = conferenceMappings.find(mapping => mapping.provider === 'zoom')
  const organizer = hosts.find(host => host.isOrganizer) ?? hosts[0]
  const deleting = action === 'delete' || booking.status === 'cancelled' || booking.status === 'rejected'
  let sharedMeetingUrl = booking.meetingUrl

  if (booking.locationType === 'zoom' && organizer) {
    const zoomConnection = await zoomConnectionFor(organizer.userId)
    if (deleting) {
      // Disconnecting Zoom deliberately leaves already-created meetings in
      // place. When authorization still exists, cancellation removes both the
      // remote meeting and its local mapping.
      if (conferenceMapping && zoomConnection?.status === 'active') {
        await deleteZoomMeeting(organizer.userId, conferenceMapping.meetingId)
        await db.delete(bookingConferenceMeetings)
          .where(eq(bookingConferenceMeetings.id, conferenceMapping.id))
      }
    } else {
      if (!zoomConnection || zoomConnection.status !== 'active') {
        throw new Error('The organizer must reconnect Zoom before this booking can be synchronized.')
      }
      const remote = await upsertZoomMeeting(
        organizer.userId,
        conferenceMapping?.meetingId ?? null,
        {
          uid: booking.uid,
          title: booking.eventTitle,
          description: booking.eventDescription,
          startsAt: booking.startsAt,
          endsAt: booking.endsAt,
          attendeeName: booking.attendeeName,
          attendeeEmail: booking.attendeeEmail,
          additionalGuestEmails: booking.additionalGuestEmails,
          notes: bookingAnswersText(booking.answers).slice(0, 1000) || null
        }
      )
      const joinUrl = remote.joinUrl ?? conferenceMapping?.joinUrl
      if (!joinUrl) throw new Error('Zoom did not return a join link for this meeting.')
      sharedMeetingUrl = joinUrl
      if (joinUrl !== booking.meetingUrl) {
        await db.update(bookings).set({ meetingUrl: joinUrl, updatedAt: sql`now()` })
          .where(eq(bookings.id, booking.id))
      }
      await db.insert(bookingConferenceMeetings).values({
        bookingId: booking.id,
        userId: organizer.userId,
        connectionId: zoomConnection.id,
        provider: 'zoom',
        meetingId: remote.id,
        joinUrl
      }).onConflictDoUpdate({
        target: [bookingConferenceMeetings.bookingId, bookingConferenceMeetings.provider],
        set: {
          userId: organizer.userId,
          connectionId: zoomConnection.id,
          meetingId: remote.id,
          joinUrl,
          syncedAt: sql`now()`,
          updatedAt: sql`now()`
        }
      })
    }
  }

  const mappingByUser = new Map(mappings.map(mapping => [mapping.userId, mapping]))
  const hostConnections = (await Promise.all(hosts.map(async host => ({
    ...host,
    connected: (await connectedCalendarProviders(host.userId))[0] ?? null
  })))).filter(host => host.connected?.connection.writeCalendarId)

  // Revoking a connection intentionally ends future synchronization. Existing
  // remote events are left in place, which the disconnect confirmation explains.
  if (!hostConnections.length) return

  if (deleting) {
    for (const host of hostConnections) {
      const { connection, provider } = host.connected!
      const mapping = mappingByUser.get(host.userId)
      if (mapping) {
        await provider.deleteEvent(host.userId, mapping.calendarId, mapping.eventId)
        await db.delete(bookingCalendarEvents).where(eq(bookingCalendarEvents.id, mapping.id))
      } else if (connection.writeCalendarId) {
        const calendarKey = host.isOrganizer ? booking.uid : `${booking.uid}:${host.userId}`
        await provider.deleteEvent(
          host.userId,
          connection.writeCalendarId,
          provider.eventId(calendarKey)
        )
      }
    }
    return
  }

  // Exactly one remote event sends guest invitations and, for Google Meet,
  // creates the conference. Every co-host still receives their own private
  // calendar event, avoiding duplicate invitations in the guest's calendar.
  const primary = hostConnections.find(host => host.isOrganizer) ?? hostConnections[0]!
  const ordered = [primary, ...hostConnections.filter(host => host.userId !== primary.userId)]
  for (const host of ordered) {
    const { connection, provider } = host.connected!
    // `hostConnections` only contains writable selections. This local alias
    // also keeps the provider calls and mapping writes explicitly non-null.
    const writeCalendarId = connection.writeCalendarId!

    let current = mappingByUser.get(host.userId)
    if (current && current.calendarId !== writeCalendarId) {
      await provider.deleteEvent(host.userId, current.calendarId, current.eventId)
      await db.delete(bookingCalendarEvents).where(eq(bookingCalendarEvents.id, current.id))
      current = undefined
    }

    const remote = await provider.upsertEvent(
      host.userId,
      writeCalendarId,
      current?.eventId ?? null,
      {
        uid: booking.uid,
        // Preserve the organizer's pre-team deterministic id so upgrades do
        // not create a duplicate personal/organizer event. Co-host copies need
        // their own key in case two hosts write to the same shared calendar.
        calendarEventKey: host.isOrganizer ? booking.uid : `${booking.uid}:${host.userId}`,
        title: booking.eventTitle,
        description: booking.eventDescription,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        attendeeName: booking.attendeeName,
        attendeeEmail: booking.attendeeEmail,
        additionalGuestEmails: booking.additionalGuestEmails,
        locationType: booking.locationType,
        locationDetails: booking.locationDetails,
        meetingUrl: sharedMeetingUrl,
        inviteGuests: host.userId === primary.userId,
        // Google Calendar descriptions have a finite size; preserve useful
        // context without letting several long answers make sync fail.
        notes: bookingAnswersText(booking.answers).slice(0, 5000) || null
      }
    )

    if (host.userId === primary.userId && remote.meetingUrl) {
      sharedMeetingUrl = remote.meetingUrl
      if (remote.meetingUrl !== booking.meetingUrl) {
        await db.update(bookings).set({
          meetingUrl: remote.meetingUrl,
          updatedAt: sql`now()`
        }).where(eq(bookings.id, booking.id))
      }
    }

    await db.insert(bookingCalendarEvents).values({
      bookingId: booking.id,
      userId: host.userId,
      connectionId: connection.id,
      calendarId: writeCalendarId,
      eventId: remote.id
    }).onConflictDoUpdate({
      target: [bookingCalendarEvents.bookingId, bookingCalendarEvents.userId],
      set: {
        connectionId: connection.id,
        calendarId: writeCalendarId,
        eventId: remote.id,
        syncedAt: sql`now()`,
        updatedAt: sql`now()`
      }
    })
  }

  if (['google_meet', 'zoom'].includes(booking.locationType) && !sharedMeetingUrl) {
    throw new Error(`${booking.locationType === 'zoom' ? 'Zoom' : 'Google Meet'} is still preparing the join link.`)
  }
}

export async function processCalendarSyncJobs(batchSize = 10) {
  const db = useDatabase()

  const jobs = await db.transaction(async (tx) => {
    await tx.update(calendarSyncJobs).set({
      status: 'pending',
      lockedAt: null,
      availableAt: sql`now()`,
      updatedAt: sql`now()`
    }).where(and(
      eq(calendarSyncJobs.status, 'processing'),
      lt(calendarSyncJobs.lockedAt, sql`now() - interval '10 minutes'`)
    ))

    const pending = await tx.select().from(calendarSyncJobs)
      .where(and(eq(calendarSyncJobs.status, 'pending'), lte(calendarSyncJobs.availableAt, sql`now()`)))
      .orderBy(asc(calendarSyncJobs.availableAt), asc(calendarSyncJobs.createdAt))
      .limit(batchSize)
      .for('update', { skipLocked: true })

    if (!pending.length) return []

    return tx.update(calendarSyncJobs).set({
      status: 'processing',
      lockedAt: sql`now()`,
      attempts: sql`${calendarSyncJobs.attempts} + 1`,
      updatedAt: sql`now()`
    }).where(inArray(calendarSyncJobs.id, pending.map(job => job.id))).returning()
  })

  for (const job of jobs) {
    try {
      await syncBooking(job.bookingId, job.action)
      await db.update(calendarSyncJobs).set({
        status: 'completed',
        completedAt: sql`now()`,
        lockedAt: null,
        lastError: null,
        updatedAt: sql`now()`
      }).where(eq(calendarSyncJobs.id, job.id))
    } catch (error) {
      const failed = job.attempts >= 8
      const delaySeconds = Math.min(3600, 15 * 2 ** Math.max(0, job.attempts - 1))
      await db.update(calendarSyncJobs).set({
        status: failed ? 'failed' : 'pending',
        availableAt: new Date(Date.now() + delaySeconds * 1000),
        lockedAt: null,
        lastError: String(error instanceof Error ? error.message : error).slice(0, 1000),
        updatedAt: sql`now()`
      }).where(eq(calendarSyncJobs.id, job.id))

      console.error(JSON.stringify({
        level: 'error',
        event: 'calendar_sync_failed',
        jobId: job.id,
        attempt: job.attempts,
        terminal: failed
      }))
    }
  }

  return jobs.length
}
