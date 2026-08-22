import { and, eq, gte, lte, sql } from 'drizzle-orm'
import { getAvailableSlots } from '../domain/availability'
import type { AvailabilityRule, DateOverride, Slot, Weekday } from '../domain/types'
import { availabilityRules, bookings, dateOverrides, eventTypes, schedules, users } from '../database/schema'
import { useDatabase } from './database'

export interface PublicEventType {
  id: string
  hostId: string
  hostName: string
  hostTimeZone: string
  username: string
  slug: string
  title: string
  description: string | null
  durationMinutes: number
  scheduleTimeZone: string
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
      incrementMinutes: eventTypes.incrementMinutes,
      bufferBeforeMinutes: eventTypes.bufferBeforeMinutes,
      bufferAfterMinutes: eventTypes.bufferAfterMinutes,
      minimumNoticeMinutes: eventTypes.minimumNoticeMinutes,
      bookingWindowDays: eventTypes.bookingWindowDays,
      maxPerDay: eventTypes.maxPerDay,
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

type EventTypeRow = NonNullable<Awaited<ReturnType<typeof findPublicEventType>>>

export async function slotsFor(event: EventTypeRow, from: string, to: string, now: string): Promise<Slot[]> {
  const db = useDatabase()
  const timeZone = event.scheduleTimeZone ?? event.hostTimeZone

  const [rules, overrides, taken] = await Promise.all([
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

    db.select({ start: bookings.startsAt, end: bookings.endsAt })
      .from(bookings)
      .where(and(
        eq(bookings.hostId, event.hostId),
        sql`${bookings.status} in ('pending', 'confirmed')`,
        gte(bookings.endsAt, new Date(now))
      ))
  ])

  const grouped = new Map<string, DateOverride>()
  for (const row of overrides) {
    const entry = grouped.get(row.date) ?? { date: row.date, windows: [] }
    if (row.startTime && row.endTime) {
      entry.windows.push({ start: wall(row.startTime), end: wall(row.endTime) })
    }
    grouped.set(row.date, entry)
  }

  return getAvailableSlots({
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
      durationMinutes: event.durationMinutes,
      incrementMinutes: event.incrementMinutes ?? undefined,
      bufferBeforeMinutes: event.bufferBeforeMinutes,
      bufferAfterMinutes: event.bufferAfterMinutes,
      minimumNoticeMinutes: event.minimumNoticeMinutes,
      bookingWindowDays: event.bookingWindowDays ?? undefined,
      maxPerDay: event.maxPerDay ?? undefined
    },
    bookings: taken.map(row => ({
      start: row.start.toISOString(),
      end: row.end.toISOString()
    })),
    from,
    to,
    now
  })
}
