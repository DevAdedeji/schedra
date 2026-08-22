import { and, asc, eq, inArray, lt, lte, sql } from 'drizzle-orm'
import type { Database } from '../database/client'
import {
  bookingCalendarEvents,
  bookings,
  calendarSyncJobs,
  eventTypes
} from '../database/schema'
import { useDatabase } from './database'
import {
  deleteGoogleCalendarEvent,
  googleConnectionFor,
  upsertGoogleCalendarEvent
} from './google-calendar'

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
    select ${bookings.id}, 'upsert', 'upsert:' || ${bookings.id}::text
    from ${bookings}
    where ${bookings.hostId} = ${userId}
      and ${bookings.status} in ('pending', 'confirmed')
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
    answers: bookings.answers,
    eventTitle: eventTypes.title,
    eventDescription: eventTypes.description
  }).from(bookings)
    .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
    .where(eq(bookings.id, bookingId))
    .limit(1)

  if (!booking) return

  const [mapping] = await db.select().from(bookingCalendarEvents)
    .where(eq(bookingCalendarEvents.bookingId, booking.id)).limit(1)
  const connection = await googleConnectionFor(booking.hostId)

  // Revoking a connection intentionally ends future synchronization. Existing
  // Google events are left in place, which the disconnect confirmation explains.
  if (!connection) return

  if (action === 'delete' || booking.status === 'cancelled' || booking.status === 'rejected') {
    if (!mapping) return
    await deleteGoogleCalendarEvent(booking.hostId, mapping.calendarId, mapping.eventId)
    await db.delete(bookingCalendarEvents).where(eq(bookingCalendarEvents.id, mapping.id))
    return
  }

  if (!connection.writeCalendarId) throw new Error('Choose a Google calendar for new booking events.')

  let current = mapping
  if (current && current.calendarId !== connection.writeCalendarId) {
    await deleteGoogleCalendarEvent(booking.hostId, current.calendarId, current.eventId)
    await db.delete(bookingCalendarEvents).where(eq(bookingCalendarEvents.id, current.id))
    current = undefined
  }

  const remote = await upsertGoogleCalendarEvent(
    booking.hostId,
    connection.writeCalendarId,
    current?.eventId ?? null,
    {
      uid: booking.uid,
      title: booking.eventTitle,
      description: booking.eventDescription,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      attendeeName: booking.attendeeName,
      attendeeEmail: booking.attendeeEmail,
      notes: typeof booking.answers === 'object' && booking.answers && 'notes' in booking.answers
        ? String(booking.answers.notes)
        : null
    }
  )

  await db.insert(bookingCalendarEvents).values({
    bookingId: booking.id,
    connectionId: connection.id,
    calendarId: connection.writeCalendarId,
    eventId: remote.id
  }).onConflictDoUpdate({
    target: bookingCalendarEvents.bookingId,
    set: {
      connectionId: connection.id,
      calendarId: connection.writeCalendarId,
      eventId: remote.id,
      syncedAt: sql`now()`,
      updatedAt: sql`now()`
    }
  })
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
