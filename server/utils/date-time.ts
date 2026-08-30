import { Temporal } from '@js-temporal/polyfill'

export const SECOND_MS = 1_000
export const MINUTE_MS = 60 * SECOND_MS
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS

export type InstantInput = string | number | Date

function instant(value: InstantInput) {
  if (typeof value === 'number') return Temporal.Instant.fromEpochMilliseconds(value)
  return Temporal.Instant.from(value instanceof Date ? value.toISOString() : value)
}

export function addToInstant(value: InstantInput, duration: Temporal.DurationLike) {
  return new Date(instant(value).add(duration).epochMilliseconds)
}

export function subtractFromInstant(value: InstantInput, duration: Temporal.DurationLike) {
  return new Date(instant(value).subtract(duration).epochMilliseconds)
}

export function addUtcCalendarDays(date: string, days: number) {
  return Temporal.PlainDate.from(date).add({ days }).toString()
}

export function utcCalendarDateBoundary(date: string, dayOffset = 0) {
  const calendarDate = addUtcCalendarDays(date, dayOffset)
  return new Date(Temporal.Instant.from(`${calendarDate}T00:00:00Z`).epochMilliseconds)
}

export function bookingLimitRange(from: string, to: string, timeZone: string) {
  const first = Temporal.PlainDate.from(from)
  const last = Temporal.PlainDate.from(to)
  const weekStart = first.subtract({ days: first.dayOfWeek - 1 })
  const monthStart = first.with({ day: 1 })
  const start = Temporal.PlainDate.compare(weekStart, monthStart) < 0 ? weekStart : monthStart
  const weekEnd = last.add({ days: 8 - last.dayOfWeek })
  const monthEnd = last.with({ day: 1 }).add({ months: 1 })
  const end = Temporal.PlainDate.compare(weekEnd, monthEnd) > 0 ? weekEnd : monthEnd
  const midnight = Temporal.PlainTime.from('00:00')

  return {
    start: new Date(start.toZonedDateTime({ timeZone, plainTime: midnight }).toInstant().epochMilliseconds),
    end: new Date(end.toZonedDateTime({ timeZone, plainTime: midnight }).toInstant().epochMilliseconds)
  }
}

export function addUtcCalendarPeriod(
  value: InstantInput,
  duration: Pick<Temporal.DurationLike, 'years' | 'months' | 'weeks' | 'days'>
) {
  return new Date(instant(value).toZonedDateTimeISO('UTC').add(duration).toInstant().epochMilliseconds)
}

export function calendarDaysBetween(from: string, to: string) {
  return Temporal.PlainDate.from(from).until(Temporal.PlainDate.from(to), { largestUnit: 'day' }).days
}

export function unixSeconds(value: InstantInput = Date.now()) {
  return Math.floor(instant(value).epochMilliseconds / SECOND_MS)
}

export function utcCalendarDate(value: InstantInput) {
  return instant(value).toZonedDateTimeISO('UTC').toPlainDate().toString()
}
