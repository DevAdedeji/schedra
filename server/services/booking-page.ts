import { and, eq, gte, isNull, lt, lte, ne, sql } from 'drizzle-orm'
import { getAvailableSlots } from '../domain/availability'
import type { AvailabilityRule, DateOverride, Slot, Weekday } from '../domain/types'
import { availabilityRules, bookingHosts, bookings, dateOverrides, eventTypes, schedules, users } from '../database/schema'
import { useDatabase } from '../database'
import { calendarBusyTimes } from '../integrations/calendar/providers'
import { bookingLimitRange, utcCalendarDateBoundary } from '../utils/date-time'
import { eventTypeDurationOptions, type BookingQuestion } from '#shared/validation'
import { groupSessionCapacity } from './group-events'
import { awayIntervalsForUser } from './away-periods'

export interface PublicEventType {
  id: string
  hostId: string
  hostName: string
  hostEmail: string
  hostTimeZone: string
  username: string
  slug: string
  title: string
  description: string | null
  durationMinutes: number
  additionalDurationMinutes: number[]
  recurringBookingEnabled: boolean
  recurringBookingMaxOccurrences: number
  scheduleTimeZone: string | null
  locationType: 'google_meet' | 'microsoft_teams' | 'zoom' | 'video_link' | 'phone' | 'in_person' | 'custom'
  locationDetails: string
  reminderMinutes: number[]
  bookingQuestions: BookingQuestion[]
  requiresConfirmation: boolean
  capacity: number
  paymentEnabled: boolean
  priceCents: number | null
  paymentCurrency: string
}

/** `HH:MM:SS` from Postgres `time`, trimmed to what the engine expects. */
function wall(value: string) {
  return value.slice(0, 5)
}

export async function findPublicEventType(username: string, slug: string) {
  const db = useDatabase()

  const [row] = await db
    .select({
      id: eventTypes.id,
      hostId: users.id,
      hostName: users.name,
      hostEmail: users.email,
      hostTimeZone: users.timeZone,
      username: users.username,
      slug: eventTypes.slug,
      title: eventTypes.title,
      description: eventTypes.description,
      durationMinutes: eventTypes.durationMinutes,
      additionalDurationMinutes: eventTypes.additionalDurationMinutes,
      recurringBookingEnabled: eventTypes.recurringBookingEnabled,
      recurringBookingMaxOccurrences: eventTypes.recurringBookingMaxOccurrences,
      incrementMinutes: eventTypes.incrementMinutes,
      bufferBeforeMinutes: eventTypes.bufferBeforeMinutes,
      bufferAfterMinutes: eventTypes.bufferAfterMinutes,
      minimumNoticeMinutes: eventTypes.minimumNoticeMinutes,
      bookingWindowDays: eventTypes.bookingWindowDays,
      maxPerDay: eventTypes.maxPerDay,
      maxPerWeek: eventTypes.maxPerWeek,
      maxPerMonth: eventTypes.maxPerMonth,
      locationType: eventTypes.locationType,
      locationDetails: eventTypes.locationDetails,
      reminderMinutes: eventTypes.reminderMinutes,
      bookingQuestions: eventTypes.bookingQuestions,
      requiresConfirmation: eventTypes.requiresConfirmation,
      capacity: eventTypes.capacity,
      paymentEnabled: eventTypes.paymentEnabled,
      priceCents: eventTypes.priceCents,
      paymentCurrency: eventTypes.paymentCurrency,
      scheduleId: eventTypes.scheduleId,
      scheduleTimeZone: schedules.timeZone
    })
    .from(eventTypes)
    .innerJoin(users, eq(users.id, eventTypes.userId))
    .leftJoin(schedules, eq(schedules.id, eventTypes.scheduleId))
    .where(and(
      sql`lower(${users.username}) = ${username.toLowerCase()}`,
      sql`lower(${eventTypes.slug}) = ${slug.toLowerCase()}`,
      eq(users.emailVerified, true),
      eq(eventTypes.hidden, false)
    ))
    .limit(1)

  return row ?? null
}

export type EventTypeRow = NonNullable<Awaited<ReturnType<typeof findPublicEventType>>>
type SlotEventTypeRow = Omit<EventTypeRow, 'recurringBookingEnabled' | 'recurringBookingMaxOccurrences'>

export async function slotsFor(
  event: SlotEventTypeRow,
  from: string,
  to: string,
  now: string,
  requestedDurationMinutes = event.durationMinutes,
  provisionalLimitBookings: Array<{ start: string, end: string }> = [],
  excludedBookingId?: string
): Promise<Slot[]> {
  const durationOptions = eventTypeDurationOptions(event)
  if (!durationOptions.includes(requestedDurationMinutes)) {
    throw createError({ statusCode: 400, statusMessage: 'Choose one of the offered meeting durations.' })
  }
  const db = useDatabase()
  const timeZone = event.scheduleTimeZone ?? event.hostTimeZone
  // Expand beyond the requested local dates because the schedule's timezone
  // can put its boundary on a different UTC day.
  const busyFrom = utcCalendarDateBoundary(from, -1).toISOString()
  const busyTo = utcCalendarDateBoundary(to, 2).toISOString()
  const limitRange = bookingLimitRange(from, to, timeZone)

  const [rules, overrides, taken, externalBusy, groupSessions, awayIntervals] = await Promise.all([
    event.scheduleId
      ? db.select({
          weekday: availabilityRules.weekday,
          startTime: availabilityRules.startTime,
          endTime: availabilityRules.endTime
        }).from(availabilityRules).where(eq(availabilityRules.scheduleId, event.scheduleId))
      : Promise.resolve([]),

    event.scheduleId
      ? db.select({
          date: dateOverrides.date,
          startTime: dateOverrides.startTime,
          endTime: dateOverrides.endTime
        }).from(dateOverrides).where(and(
          eq(dateOverrides.scheduleId, event.scheduleId),
          gte(dateOverrides.date, from),
          lte(dateOverrides.date, to)
        ))
      : Promise.resolve([]),

    db.select({
      id: bookings.id,
      eventTypeId: bookings.eventTypeId,
      groupSessionId: bookings.groupSessionId,
      start: bookings.startsAt,
      end: bookings.endsAt,
      reservedStart: bookingHosts.reservedStartsAt,
      reservedEnd: bookingHosts.reservedEndsAt
    })
      .from(bookingHosts)
      .innerJoin(bookings, eq(bookings.id, bookingHosts.bookingId))
      .where(and(
        eq(bookingHosts.userId, event.hostId),
        isNull(bookingHosts.releasedAt),
        excludedBookingId ? ne(bookings.id, excludedBookingId) : undefined,
        gte(bookingHosts.reservedEndsAt, limitRange.start),
        lt(bookingHosts.reservedStartsAt, limitRange.end)
      )),

    calendarBusyTimes(event.hostId, busyFrom, busyTo),

    event.capacity > 1
      ? groupSessionCapacity(event.id, new Date(busyFrom), new Date(busyTo))
      : Promise.resolve([]),

    awayIntervalsForUser(event.hostId, from, to)
  ])

  const openSessions = groupSessions.filter(session => session.availableSeats > 0
    && (session.endsAt.getTime() - session.startsAt.getTime()) / 60_000 === requestedDurationMinutes)
  const openSessionBySpan = new Map(openSessions
    .map(session => [`${session.startsAt.getTime()}:${session.endsAt.getTime()}`, session]))
  const currentSessionIds = new Set(groupSessions.map(session => session.id))
  const openSessionIds = new Set(openSessions.map(session => session.id))
  const busyBookings = taken.filter(row => !row.groupSessionId
    || !currentSessionIds.has(row.groupSessionId)
    || !openSessionIds.has(row.groupSessionId))
  // A shared session consumes one item from the host's daily limit, not one
  // item per guest. This also deduplicates group sessions from other event
  // types, which are present in `taken` but not in this event's session query.
  const limitBookings = [...new Map(taken.filter(row => row.eventTypeId === event.id).map(row => [
    row.groupSessionId ? `group:${row.groupSessionId}` : `booking:${row.id}`,
    { start: row.start, end: row.end }
  ])).values()]
  // Calendar providers report Schedra's own shared invite as busy. Ignore only
  // an exact open session span; unrelated and partially overlapping events
  // continue to protect the host.
  const effectiveExternalBusy = externalBusy.filter(interval => !openSessions.some(session =>
    Date.parse(interval.start) === session.startsAt.getTime()
    && Date.parse(interval.end) === session.endsAt.getTime()
  ))

  const grouped = new Map<string, DateOverride>()
  for (const row of overrides) {
    const entry = grouped.get(row.date) ?? { date: row.date, windows: [] }
    if (row.startTime && row.endTime) {
      entry.windows.push({ start: wall(row.startTime), end: wall(row.endTime) })
    }
    grouped.set(row.date, entry)
  }

  const slots = getAvailableSlots({
    schedule: {
      timeZone,
      rules: rules.map(rule => ({
        weekday: rule.weekday as Weekday,
        start: wall(rule.startTime),
        end: wall(rule.endTime)
      })) satisfies AvailabilityRule[],
      overrides: [...grouped.values()]
    },
    eventType: {
      durationMinutes: requestedDurationMinutes,
      incrementMinutes: event.incrementMinutes ?? Math.min(...durationOptions),
      bufferBeforeMinutes: event.bufferBeforeMinutes,
      bufferAfterMinutes: event.bufferAfterMinutes,
      minimumNoticeMinutes: event.minimumNoticeMinutes,
      bookingWindowDays: event.bookingWindowDays ?? undefined,
      maxPerDay: event.maxPerDay ?? undefined,
      maxPerWeek: event.maxPerWeek ?? undefined,
      maxPerMonth: event.maxPerMonth ?? undefined
    },
    bookings: busyBookings.map(row => ({
      start: row.reservedStart.toISOString(),
      end: row.reservedEnd.toISOString()
    })),
    limitBookings: [...limitBookings.map(row => ({
      start: row.start.toISOString(),
      end: row.end.toISOString()
    })), ...provisionalLimitBookings],
    limitExemptSlots: openSessions.map(session => ({
      start: session.startsAt.toISOString(),
      end: session.endsAt.toISOString()
    })),
    externalBusy: effectiveExternalBusy,
    unavailable: awayIntervals,
    from,
    to,
    now
  })

  return slots.map(slot => ({
    ...slot,
    ...(event.capacity > 1
      ? { availableSeats: openSessionBySpan.get(`${Date.parse(slot.start)}:${Date.parse(slot.end)}`)?.availableSeats ?? event.capacity }
      : {})
  }))
}
