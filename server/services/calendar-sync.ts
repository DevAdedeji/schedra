import { and, asc, eq, inArray, lt, lte, sql } from 'drizzle-orm'
import type { Database } from '../database/client'
import {
  bookingCalendarEvents,
  bookingConferenceMeetings,
  bookingHosts,
  bookings,
  calendarConnections,
  calendarSyncJobs,
  eventTypes
} from '../database/schema'
import { useDatabase } from '../database'
import {
  calendarDestinationProvider,
  calendarProvider,
  calendarProviderForLocation
} from '../integrations/calendar/providers'
import { IntegrationUnavailableError } from '../integrations/errors'
import { bookingAnswersText } from '../domain/booking-answers'
import {
  deleteZoomMeeting,
  upsertZoomMeeting,
  zoomConnectionFor
} from '../integrations/video/zoom'
import { logEvent } from '../observability/logger'
import { canonicalBookingId, confirmedGroupSeats } from './group-events'
import { addToInstant } from '../utils/date-time'

export type CalendarSyncExecutor = Pick<Database, 'insert' | 'select'>
export type CalendarSyncAction = 'upsert' | 'delete'

export async function enqueueCalendarSync(
  bookingId: string,
  action: CalendarSyncAction,
  executor: CalendarSyncExecutor = useDatabase()
) {
  const syncBookingId = await canonicalBookingId(bookingId, executor)
  await executor.insert(calendarSyncJobs).values({
    bookingId: syncBookingId,
    action,
    dedupeKey: `booking:${syncBookingId}`
  }).onConflictDoUpdate({
    target: calendarSyncJobs.bookingId,
    set: {
      action,
      dedupeKey: `booking:${syncBookingId}`,
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
    select distinct target.booking_id, 'upsert'::calendar_sync_action,
      'booking:' || target.booking_id::text
    from (
      select case
        when b.group_session_id is null then b.id
        else (
          select canonical.id from bookings canonical
          where canonical.group_session_id = b.group_session_id
          order by canonical.created_at, canonical.id
          limit 1
        )
      end as booking_id
      from bookings b
      inner join booking_hosts bh on bh.booking_id = b.id
      where bh.user_id = ${userId}
        and bh.released_at is null
        and b.status = 'confirmed'
        and b.ends_at > now()
    ) target
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

export async function enqueueCalendarReconciliation(batchSize = 100) {
  const safeBatchSize = Math.max(1, Math.min(500, Math.trunc(batchSize)))
  const queued = await useDatabase().execute(sql`
    with candidates as (
      select target.booking_id
      from (
        select distinct
          case
            when b.group_session_id is null then b.id
            else (
              select canonical.id from bookings canonical
              where canonical.group_session_id = b.group_session_id
              order by canonical.created_at, canonical.id
              limit 1
            )
          end as booking_id,
          bh.user_id
        from bookings b
        inner join booking_hosts bh on bh.booking_id = b.id
        where bh.released_at is null
          and b.status = 'confirmed'
          and b.ends_at > now()
          and b.starts_at < now() + interval '90 days'
      ) target
      inner join calendar_connections cc
        on cc.user_id = target.user_id
       and cc.status = 'active'
       and cc.write_calendar_id is not null
      left join booking_calendar_events bce
        on bce.booking_id = target.booking_id
       and bce.user_id = target.user_id
      where bce.id is null
         or bce.synced_at < now() - interval '12 hours'
      group by target.booking_id
      order by min(coalesce(bce.synced_at, '-infinity'::timestamptz)), target.booking_id
      limit ${safeBatchSize}
    )
    insert into calendar_sync_jobs (booking_id, action, dedupe_key)
    select booking_id, 'upsert'::calendar_sync_action, 'booking:' || booking_id::text
    from candidates
    on conflict (booking_id) do update set
      action = 'upsert'::calendar_sync_action,
      dedupe_key = excluded.dedupe_key,
      revision = ${calendarSyncJobs.revision} + 1,
      status = 'pending'::calendar_sync_status,
      attempts = 0,
      available_at = now(),
      locked_at = null,
      completed_at = null,
      last_error = null,
      failure_provider = null,
      updated_at = now()
    where ${calendarSyncJobs.status} = 'completed'
    returning booking_id
  `)
  return queued.length
}

async function syncBooking(bookingId: string, action: CalendarSyncAction) {
  const db = useDatabase()
  const [booking] = await db.select({
    id: bookings.id,
    groupSessionId: bookings.groupSessionId,
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

  const [hosts, mappings, conferenceMappings, groupSeats] = await Promise.all([
    db.select({
      userId: bookingHosts.userId,
      isOrganizer: bookingHosts.isOrganizer
    }).from(bookingHosts)
      .where(eq(bookingHosts.bookingId, booking.id))
      .orderBy(sql`${bookingHosts.isOrganizer} desc`, bookingHosts.createdAt, bookingHosts.id),
    db.select().from(bookingCalendarEvents)
      .where(eq(bookingCalendarEvents.bookingId, booking.id)),
    db.select().from(bookingConferenceMeetings)
      .where(eq(bookingConferenceMeetings.bookingId, booking.id)),
    booking.groupSessionId ? confirmedGroupSeats(booking.groupSessionId, db) : Promise.resolve([])
  ])

  const primarySeat = groupSeats[0]
  const attendeeName = primarySeat?.attendeeName ?? booking.attendeeName
  const attendeeEmail = primarySeat?.attendeeEmail ?? booking.attendeeEmail
  const additionalGuestEmails = groupSeats.length
    ? [...new Set(groupSeats.flatMap(seat => [
        ...(seat.id === primarySeat?.id ? [] : [seat.attendeeEmail]),
        ...seat.additionalGuestEmails
      ]).filter(email => email !== attendeeEmail))]
    : booking.additionalGuestEmails
  const conferenceMapping = conferenceMappings.find(mapping => mapping.provider === 'zoom')
  const organizer = hosts.find(host => host.isOrganizer) ?? hosts[0]
  // A seat cancellation updates the shared invite. The remote meeting is only
  // removed once the final active seat leaves the session.
  const deleting = booking.groupSessionId
    ? groupSeats.length === 0
    : action === 'delete' || booking.status === 'cancelled' || booking.status === 'rejected'
  let sharedMeetingUrl = booking.meetingUrl
  const preferredCalendarProvider = calendarProviderForLocation(booking.locationType)

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
          attendeeName
        }
      )
      const joinUrl = remote.joinUrl ?? conferenceMapping?.joinUrl
      if (!joinUrl) throw new Error('Zoom did not return a join link for this meeting.')
      sharedMeetingUrl = joinUrl
      if (joinUrl !== booking.meetingUrl) {
        await db.update(bookings).set({ meetingUrl: joinUrl, updatedAt: sql`now()` })
          .where(booking.groupSessionId
            ? and(eq(bookings.groupSessionId, booking.groupSessionId), eq(bookings.status, 'confirmed'))
            : eq(bookings.id, booking.id))
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
    connected: await calendarDestinationProvider(host.userId, preferredCalendarProvider)
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
          await db.update(calendarConnections).set({
            lastError: null,
            lastCheckedAt: sql`now()`,
            updatedAt: sql`now()`
          }).where(eq(calendarConnections.id, connection.id))
        }
        await db.delete(bookingCalendarEvents).where(eq(bookingCalendarEvents.id, mapping.id))
        continue
      }

      const destination = await calendarDestinationProvider(host.userId, preferredCalendarProvider)
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
        attendeeName,
        attendeeEmail,
        additionalGuestEmails,
        locationType: booking.locationType,
        locationDetails: booking.locationDetails,
        meetingUrl: sharedMeetingUrl,
        inviteGuests: host.userId === primary.userId,
        // Google Calendar descriptions have a finite size; preserve useful
        // context without letting several long answers make sync fail.
        notes: bookingAnswersText(primarySeat?.answers ?? booking.answers).slice(0, 5000) || null
      }
    )

    if (host.userId === primary.userId && remote.meetingUrl) {
      sharedMeetingUrl = remote.meetingUrl
      if (remote.meetingUrl !== booking.meetingUrl) {
        await db.update(bookings).set({
          meetingUrl: remote.meetingUrl,
          updatedAt: sql`now()`
        }).where(booking.groupSessionId
          ? and(eq(bookings.groupSessionId, booking.groupSessionId), eq(bookings.status, 'confirmed'))
          : eq(bookings.id, booking.id))
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
    await db.update(calendarConnections).set({
      lastError: null,
      lastCheckedAt: sql`now()`,
      updatedAt: sql`now()`
    }).where(eq(calendarConnections.id, connection.id))
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
        availableAt: addToInstant(Date.now(), { milliseconds: delayMs + Math.floor(Math.random() * 1000) }),
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
