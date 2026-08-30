import { and, eq, gte, isNull, lt } from 'drizzle-orm'
import { Temporal } from '@js-temporal/polyfill'
import type { Database } from '../database/client'
import { bookingHosts, bookings } from '../database/schema'
import { bookingLimitRange } from '../utils/date-time'

type LimitPeriod = 'day' | 'week' | 'month'

export interface BookingLimits {
  maxPerDay: number | null
  maxPerWeek: number | null
  maxPerMonth: number | null
}

interface LimitOccurrence {
  start: string | Date
  bookingId?: string
  groupSessionId?: string | null
}

export class BookingLimitReachedError extends Error {
  readonly statusCode = 409
  readonly statusMessage: string

  constructor(readonly period: LimitPeriod) {
    super(`This event type has reached its booking limit for that ${period}.`)
    this.name = 'BookingLimitReachedError'
    this.statusMessage = this.message
  }
}

function instant(value: string | Date) {
  return Temporal.Instant.from(value instanceof Date ? value.toISOString() : value)
}

function periodKeys(value: string | Date, timeZone: string) {
  const date = instant(value).toZonedDateTimeISO(timeZone).toPlainDate()
  return {
    day: date.toString(),
    week: date.subtract({ days: date.dayOfWeek - 1 }).toString(),
    month: `${date.year}-${String(date.month).padStart(2, '0')}`
  }
}

export function reachedBookingLimit(input: {
  existing: LimitOccurrence[]
  proposed: LimitOccurrence[]
  timeZone: string
  limits: BookingLimits
}): LimitPeriod | null {
  const counts = {
    day: new Map<string, number>(),
    week: new Map<string, number>(),
    month: new Map<string, number>()
  }
  const commitments = new Set<string>()

  for (const [index, occurrence] of input.existing.entries()) {
    const commitment = occurrence.groupSessionId
      ? `group:${occurrence.groupSessionId}`
      : `booking:${occurrence.bookingId ?? index}`
    if (commitments.has(commitment)) continue
    commitments.add(commitment)
    const keys = periodKeys(occurrence.start, input.timeZone)
    for (const period of ['day', 'week', 'month'] as const) {
      counts[period].set(keys[period], (counts[period].get(keys[period]) ?? 0) + 1)
    }
  }

  for (const [index, occurrence] of input.proposed.entries()) {
    const commitment = occurrence.groupSessionId
      ? `group:${occurrence.groupSessionId}`
      : `proposed:${index}`
    if (commitments.has(commitment)) continue
    commitments.add(commitment)
    const keys = periodKeys(occurrence.start, input.timeZone)
    const limits = {
      day: input.limits.maxPerDay,
      week: input.limits.maxPerWeek,
      month: input.limits.maxPerMonth
    }
    for (const period of ['day', 'week', 'month'] as const) {
      const next = (counts[period].get(keys[period]) ?? 0) + 1
      if (limits[period] !== null && next > limits[period]!) return period
      counts[period].set(keys[period], next)
    }
  }

  return null
}

export async function assertBookingLimits(input: {
  executor: Pick<Database, 'select'>
  eventTypeId: string
  hosts: Array<{ userId: string, timeZone: string }>
  occurrences: Array<{ startsAt: string, groupSessionId?: string | null }>
  limits: BookingLimits
}) {
  if (!input.limits.maxPerDay && !input.limits.maxPerWeek && !input.limits.maxPerMonth) return
  if (!input.occurrences.length) return

  for (const host of input.hosts) {
    const dates = input.occurrences.map(occurrence => instant(occurrence.startsAt)
      .toZonedDateTimeISO(host.timeZone).toPlainDate())
    const from = dates.reduce((earliest, date) => Temporal.PlainDate.compare(date, earliest) < 0 ? date : earliest)
    const to = dates.reduce((latest, date) => Temporal.PlainDate.compare(date, latest) > 0 ? date : latest)
    const range = bookingLimitRange(from.toString(), to.toString(), host.timeZone)
    const existing = await input.executor.select({
      bookingId: bookingHosts.bookingId,
      groupSessionId: bookingHosts.groupSessionId,
      start: bookingHosts.startsAt
    }).from(bookingHosts)
      .innerJoin(bookings, eq(bookings.id, bookingHosts.bookingId))
      .where(and(
        eq(bookingHosts.userId, host.userId),
        eq(bookings.eventTypeId, input.eventTypeId),
        isNull(bookingHosts.releasedAt),
        gte(bookingHosts.endsAt, range.start),
        lt(bookingHosts.startsAt, range.end)
      ))

    const period = reachedBookingLimit({
      existing,
      proposed: input.occurrences.map(occurrence => ({
        start: occurrence.startsAt,
        groupSessionId: occurrence.groupSessionId
      })),
      timeZone: host.timeZone,
      limits: input.limits
    })
    if (period) throw new BookingLimitReachedError(period)
  }
}
