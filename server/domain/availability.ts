import { Temporal } from '@js-temporal/polyfill'
import type {
  AvailabilityQuery,
  DstPolicy,
  Interval,
  IsoDate,
  Schedule,
  Slot,
  TimeZone,
  WallWindow,
  Weekday
} from './types'

interface Span {
  start: Temporal.Instant
  end: Temporal.Instant
}

function compare(a: Temporal.Instant, b: Temporal.Instant) {
  return Temporal.Instant.compare(a, b)
}

function earliest(a: Temporal.Instant, b: Temporal.Instant) {
  return compare(a, b) <= 0 ? a : b
}

function latest(a: Temporal.Instant, b: Temporal.Instant) {
  return compare(a, b) >= 0 ? a : b
}

function addMinutes(instant: Temporal.Instant, minutes: number) {
  return instant.add({ minutes })
}

function toSpan(interval: Interval): Span {
  return {
    start: Temporal.Instant.from(interval.start),
    end: Temporal.Instant.from(interval.end)
  }
}

function resolve(
  date: Temporal.PlainDate,
  time: string,
  timeZone: TimeZone,
  dst: Required<DstPolicy>
): Temporal.Instant | null {
  const wall = date.toPlainDateTime(Temporal.PlainTime.from(time))
  const earlier = wall.toZonedDateTime(timeZone, { disambiguation: 'earlier' })
  const later = wall.toZonedDateTime(timeZone, { disambiguation: 'later' })

  if (earlier.epochNanoseconds === later.epochNanoseconds) {
    return earlier.toInstant()
  }

  // Gaps and ambiguities both yield two candidates, so the count cannot tell
  // them apart. An ambiguous time survives the round trip; a gap does not.
  const preserved = earlier.toPlainDateTime().equals(wall)
    && later.toPlainDateTime().equals(wall)

  if (preserved) {
    return (dst.ambiguous === 'later' ? later : earlier).toInstant()
  }

  return dst.gap === 'shift' ? later.toInstant() : null
}

function windowsOn(schedule: Schedule, date: Temporal.PlainDate): WallWindow[] {
  const override = schedule.overrides?.find(
    entry => entry.date === (date.toString() as IsoDate)
  )

  // An override replaces the weekly rules outright, including with nothing.
  if (override) return override.windows

  return schedule.rules.filter(rule => rule.weekday === (date.dayOfWeek as Weekday))
}

function merge(spans: Span[]): Span[] {
  if (spans.length < 2) return [...spans]

  const sorted = [...spans].sort((a, b) => compare(a.start, b.start))
  const merged: Span[] = [sorted[0]!]

  for (const span of sorted.slice(1)) {
    const last = merged[merged.length - 1]!
    if (compare(span.start, last.end) <= 0) {
      last.end = latest(last.end, span.end)
    } else {
      merged.push(span)
    }
  }

  return merged
}

function resolveWindows(
  schedule: Schedule,
  from: Temporal.PlainDate,
  to: Temporal.PlainDate,
  dst: Required<DstPolicy>
): Span[] {
  const spans: Span[] = []

  // Start a day early: an overnight window opened the previous evening can
  // still be running when the requested range begins.
  for (
    let date = from.subtract({ days: 1 });
    Temporal.PlainDate.compare(date, to) <= 0;
    date = date.add({ days: 1 })
  ) {
    for (const window of windowsOn(schedule, date)) {
      const endDate = window.end <= window.start ? date.add({ days: 1 }) : date
      const start = resolve(date, window.start, schedule.timeZone, dst)
      const end = resolve(endDate, window.end, schedule.timeZone, dst)

      if (!start || !end || compare(start, end) >= 0) continue
      spans.push({ start, end })
    }
  }

  return merge(spans)
}

function overlaps(a: Span, b: Span) {
  return compare(a.start, b.end) < 0 && compare(b.start, a.end) < 0
}

export function getAvailableSlots(query: AvailabilityQuery): Slot[] {
  const {
    schedule,
    eventType,
    bookings = [],
    limitBookings = bookings,
    limitExemptSlots = [],
    externalBusy = [],
    unavailable = [],
    from,
    to,
    now
  } = query

  const dst: Required<DstPolicy> = {
    gap: query.dst?.gap ?? 'skip',
    ambiguous: query.dst?.ambiguous ?? 'earlier'
  }

  const {
    durationMinutes,
    incrementMinutes = durationMinutes,
    bufferBeforeMinutes = 0,
    bufferAfterMinutes = 0,
    minimumNoticeMinutes = 0,
    bookingWindowDays,
    maxPerDay,
    maxPerWeek,
    maxPerMonth
  } = eventType

  if (durationMinutes <= 0 || incrementMinutes <= 0) return []

  const reference = Temporal.Instant.from(now)
  const rangeStart = Temporal.PlainDate.from(from)
  const rangeEnd = Temporal.PlainDate.from(to)

  const windows = resolveWindows(schedule, rangeStart, rangeEnd, dst)
  const commitments = [...bookings, ...externalBusy, ...unavailable].map(toSpan)

  const opensAt = addMinutes(reference, minimumNoticeMinutes)
  const closesAt = bookingWindowDays === undefined
    ? null
    : reference.toZonedDateTimeISO('UTC').add({ days: bookingWindowDays }).toInstant()

  const bookingsPerDay = new Map<string, number>()
  const bookingsPerWeek = new Map<string, number>()
  const bookingsPerMonth = new Map<string, number>()
  for (const booking of limitBookings) {
    const date = Temporal.Instant.from(booking.start)
      .toZonedDateTimeISO(schedule.timeZone)
      .toPlainDate()
    const day = date.toString()
    const week = date.subtract({ days: date.dayOfWeek - 1 }).toString()
    const month = `${date.year}-${String(date.month).padStart(2, '0')}`
    bookingsPerDay.set(day, (bookingsPerDay.get(day) ?? 0) + 1)
    bookingsPerWeek.set(week, (bookingsPerWeek.get(week) ?? 0) + 1)
    bookingsPerMonth.set(month, (bookingsPerMonth.get(month) ?? 0) + 1)
  }

  const exemptSpans = new Set(limitExemptSlots.map(slot => [
    Temporal.Instant.from(slot.start).epochNanoseconds,
    Temporal.Instant.from(slot.end).epochNanoseconds
  ].join(':')))

  const slots: Slot[] = []

  for (const window of windows) {
    const opens = latest(window.start, opensAt)
    const closes = closesAt ? earliest(window.end, closesAt) : window.end
    if (compare(opens, closes) >= 0) continue

    // Stepping on the absolute timeline means a DST transition inside a window
    // shifts the local times rather than corrupting the spacing.
    let cursor = window.start
    while (compare(cursor, opens) < 0) {
      cursor = addMinutes(cursor, incrementMinutes)
    }

    for (; compare(cursor, closes) < 0; cursor = addMinutes(cursor, incrementMinutes)) {
      const slot: Span = { start: cursor, end: addMinutes(cursor, durationMinutes) }
      if (compare(slot.end, closes) > 0) break

      const localDate = slot.start.toZonedDateTimeISO(schedule.timeZone).toPlainDate()
      if (Temporal.PlainDate.compare(localDate, rangeStart) < 0) continue
      if (Temporal.PlainDate.compare(localDate, rangeEnd) > 0) continue

      const limitExempt = exemptSpans.has(`${slot.start.epochNanoseconds}:${slot.end.epochNanoseconds}`)
      if (!limitExempt) {
        const day = localDate.toString()
        const week = localDate.subtract({ days: localDate.dayOfWeek - 1 }).toString()
        const month = `${localDate.year}-${String(localDate.month).padStart(2, '0')}`
        if (maxPerDay !== undefined && (bookingsPerDay.get(day) ?? 0) >= maxPerDay) continue
        if (maxPerWeek !== undefined && (bookingsPerWeek.get(week) ?? 0) >= maxPerWeek) continue
        if (maxPerMonth !== undefined && (bookingsPerMonth.get(month) ?? 0) >= maxPerMonth) continue
      }

      // Buffers protect time around the meeting without being bookable, so the
      // padded span is what must be clear while the slot itself stays exact.
      const padded: Span = {
        start: addMinutes(slot.start, -bufferBeforeMinutes),
        end: addMinutes(slot.end, bufferAfterMinutes)
      }
      if (commitments.some(commitment => overlaps(padded, commitment))) continue

      slots.push({ start: slot.start.toString(), end: slot.end.toString() })
    }
  }

  return slots
}
