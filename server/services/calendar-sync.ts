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
import { calendarDestinationProvider, calendarProvider } from '../integrations/calendar/providers'
import { IntegrationUnavailableError } from '../integrations/errors'
import { bookingAnswersText } from '../domain/booking-answers'
import {
  deleteZoomMeeting,
  upsertZoomMeeting,
  zoomConnectionFor
} from '../integrations/video/zoom'
import { logEvent } from '../observability/logger'

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
    dedupeKey: `booking:${bookingId}`
  }).onConflictDoUpdate({
    target: calendarSyncJobs.bookingId,
    set: {
      action,
      dedupeKey: `booking:${bookingId}`,
      revision: sql`${calendarSyncJobs.revision} + 1`,
      status: sql`case when ${calendarSyncJobs.status} = 'processing' then 'processing'::calendar_sync_status else 'pending'::calendar_sync_status end`,
      attempts: sql`case when ${calendarSyncJobs.status} = 'processing' then ${calendarSyncJobs.attempts} else 0 end`,
      availableAt: sql`now()`,
      completedAt: null,
      lastError: null,
      failureProvider: null,
      updatedAt: sql`now()`
    }
  })
}

export async function enqueueFutureBookingsForCalendarSync(userId: string) {
  // One set-based statement handles both first-time connections and recovery:
  // existing jobs are reopened while bookings made before the integration was
  // installed receive their first durable job.
  await useDatabase().execute(sql`
    insert into calendar_sync_jobs (booking_id, action, dedupe_key)
    select distinct ${bookings.id}, 'upsert'::calendar_sync_action, 'booking:' || ${bookings.id}::text
    from ${bookings}
    inner join ${bookingHosts} on ${bookingHosts.bookingId} = ${bookings.id}
    where ${bookingHosts.userId} = ${userId}
      and ${bookingHosts.releasedAt} is null
      and ${bookings.status} = 'confirmed'
      and ${bookings.endsAt} > now()
    on conflict (booking_id) do update set
      action = 'upsert'::calendar_sync_action,
      dedupe_key = excluded.dedupe_key,
      revision = ${calendarSyncJobs.revision} + 1,
      status = case
        when ${calendarSyncJobs.status} = 'processing' then 'processing'::calendar_sync_status
        else 'pending'::calendar_sync_status
      end,
      attempts = case when ${calendarSyncJobs.status} = 'processing' then ${calendarSyncJobs.attempts} else 0 end,
      available_at = now(),
      completed_at = null,
      last_error = null,
      failure_provider = null,
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
          attendeeName: booking.attendeeName
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
    connected: await calendarDestinationProvider(host.userId)
  })))).filter(host => host.connected?.connection.writeCalendarId)

  // Revoking a connection intentionally ends future synchronization. Existing
  // remote events are left in place, which the disconnect confirmation explains.
  if (deleting) {
    for (const host of hosts) {
      const mapping = mappingByUser.get(host.userId)
      if (mapping) {
        const provider = calendarProvider(mapping.provider)
        const connection = provider ? await provider.connectionFor(host.userId) : null
        if (provider && connection?.status === 'active') {
          await provider.deleteEvent(host.userId, mapping.calendarId, mapping.eventId)
        }
        await db.delete(bookingCalendarEvents).where(eq(bookingCalendarEvents.id, mapping.id))
        continue
      }

      const destination = await calendarDestinationProvider(host.userId)
      if (destination?.connection.writeCalendarId) {
        const calendarKey = host.isOrganizer ? booking.uid : `${booking.uid}:${host.userId}`
        await destination.provider.deleteEvent(
          host.userId,
          destination.connection.writeCalendarId,
          destination.provider.eventId(calendarKey)
        )
      }
    }
    return
  }

  if (!hostConnections.length) return

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
    if (current && (current.provider !== provider.id || current.calendarId !== writeCalendarId)) {
      const previousProvider = calendarProvider(current.provider)
      const previousConnection = previousProvider ? await previousProvider.connectionFor(host.userId) : null
      if (previousProvider && previousConnection?.status === 'active') {
        await previousProvider.deleteEvent(host.userId, current.calendarId, current.eventId)
      }
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
      provider: provider.id,
      calendarId: writeCalendarId,
      eventId: remote.id
    }).onConflictDoUpdate({
      target: [bookingCalendarEvents.bookingId, bookingCalendarEvents.userId],
      set: {
        connectionId: connection.id,
        provider: provider.id,
        calendarId: writeCalendarId,
        eventId: remote.id,
        syncedAt: sql`now()`,
        updatedAt: sql`now()`
      }
    })
  }

  if (['google_meet', 'microsoft_teams', 'zoom'].includes(booking.locationType) && !sharedMeetingUrl) {
    const providerName = booking.locationType === 'zoom'
      ? 'Zoom'
      : booking.locationType === 'microsoft_teams' ? 'Microsoft Teams' : 'Google Meet'
    throw new Error(`${providerName} is still preparing the join link.`)
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
      const completed = await db.update(calendarSyncJobs).set({
        status: 'completed',
        completedAt: sql`now()`,
        lockedAt: null,
        lastError: null,
        failureProvider: null,
        updatedAt: sql`now()`
      }).where(and(
        eq(calendarSyncJobs.id, job.id),
        eq(calendarSyncJobs.revision, job.revision),
        eq(calendarSyncJobs.status, 'processing')
      )).returning({ id: calendarSyncJobs.id })

      if (!completed.length) {
        await db.update(calendarSyncJobs).set({
          status: 'pending',
          attempts: 0,
          availableAt: sql`now()`,
          lockedAt: null,
          completedAt: null,
          lastError: null,
          failureProvider: null,
          updatedAt: sql`now()`
        }).where(and(
          eq(calendarSyncJobs.id, job.id),
          eq(calendarSyncJobs.status, 'processing')
        ))
      }
    } catch (error) {
      const integrationError = error instanceof IntegrationUnavailableError ? error : null
      const failed = integrationError?.retryable === false || job.attempts >= 8
      const exponentialDelayMs = Math.min(3_600_000, 15_000 * 2 ** Math.max(0, job.attempts - 1))
      const delayMs = Math.min(3_600_000, Math.max(exponentialDelayMs, integrationError?.retryAfterMs ?? 0))
      const failedUpdate = await db.update(calendarSyncJobs).set({
        status: failed ? 'failed' : 'pending',
        availableAt: new Date(Date.now() + delayMs + Math.floor(Math.random() * 1000)),
        lockedAt: null,
        lastError: String(error instanceof Error ? error.message : error).slice(0, 1000),
        failureProvider: integrationError?.provider ?? null,
        updatedAt: sql`now()`
      }).where(and(
        eq(calendarSyncJobs.id, job.id),
        eq(calendarSyncJobs.revision, job.revision),
        eq(calendarSyncJobs.status, 'processing')
      )).returning({ id: calendarSyncJobs.id })

      if (!failedUpdate.length) {
        await db.update(calendarSyncJobs).set({
          status: 'pending',
          attempts: 0,
          availableAt: sql`now()`,
          lockedAt: null,
          completedAt: null,
          lastError: null,
          failureProvider: null,
          updatedAt: sql`now()`
        }).where(and(
          eq(calendarSyncJobs.id, job.id),
          eq(calendarSyncJobs.status, 'processing')
        ))
      }

      logEvent('error', 'calendar_sync_failed', {
        jobId: job.id,
        attempt: job.attempts,
        terminal: failed,
        provider: integrationError?.provider ?? null,
        error
      })
    }
  }

  return jobs.length
}
