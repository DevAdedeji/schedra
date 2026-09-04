import { Temporal } from '@js-temporal/polyfill'

const WEEKS_PER_PAGE = 8

export function bookingCalendarRange(firstMonday: string, weekOffset: number) {
  const start = Temporal.PlainDate.from(firstMonday)
    .add({ days: Math.floor(Math.max(0, weekOffset) / WEEKS_PER_PAGE) * WEEKS_PER_PAGE * 7 })
  // UTC-12 and UTC+14 can be two calendar dates apart.
  return {
    from: start.subtract({ days: 2 }).toString(),
    to: start.add({ days: WEEKS_PER_PAGE * 7 + 1 }).toString()
  }
}

export function lastBookingCalendarWeek(firstMonday: string, now: string, windowDays: number | null | undefined, viewerTimeZone = 'UTC') {
  if (windowDays == null) return Number.POSITIVE_INFINITY
  const lastDay = Temporal.Instant.from(now).add({ hours: windowDays * 24 })
    .toZonedDateTimeISO(viewerTimeZone).toPlainDate()
  const distance = Temporal.PlainDate.from(firstMonday).until(lastDay, { largestUnit: 'day' }).days
  return Math.max(0, Math.floor(distance / 7))
}
