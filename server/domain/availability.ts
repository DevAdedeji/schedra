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

/**
 * The availability engine.
 *
 * Pure: no database, no network, no clock. Everything it knows arrives as
 * arguments and the same input always produces the same output — which is what
 * makes the DST behaviour testable at all.
 *
 * The pipeline, in order:
 *
 *   1. expand weekly rules into dated wall-clock windows, applying overrides
 *   2. resolve those windows to absolute intervals in the schedule's zone
 *   3. clip to the notice window and the booking horizon
 *   4. step through each window laying down candidate slots
 *   5. reject slots whose padded span collides with existing commitments
 *   6. drop days that have hit their booking cap
 */

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

function toSpan(interval: Interval): Span {
  return {
    start: Temporal.Instant.from(interval.start),
    end: Temporal.Instant.from(interval.end)
  }
}

/**
 * Resolves a wall-clock date and time in a zone to an absolute instant.
 *
 * Returns `null` when the wall time does not exist — the hour a spring-forward
 * transition deletes — and the policy says to skip rather than shift. Temporal
 * would happily push it past the gap for us, but silently inventing a time the
 * clock never showed is how bookings end up an hour out.
 */
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

  /**
   * Both a gap and an ambiguity yield two different candidates, so the count
   * alone cannot tell them apart. The discriminator is whether the wall time
   * survived the round trip: an ambiguous time exists twice and both candidates
   * report it back unchanged, whereas a gap forces Temporal to move the clock.
   */
  const preserved = earlier.toPlainDateTime().equals(wall)
    && later.toPlainDateTime().equals(wall)

  if (preserved) {
    return (dst.ambiguous === 'later' ? later : earlier).toInstant()
  }

  return dst.gap === 'shift' ? later.toInstant() : null
}

/** The wall-clock windows that apply on a given date. */
function windowsOn(schedule: Schedule, date: Temporal.PlainDate): WallWindow[] {
  const iso = date.toString() as IsoDate
  const override = schedule.overrides?.find(entry => entry.date === iso)

  // An override replaces the weekly rules outright, including with nothing at
  // all — that is how a day off is expressed.
  if (override) return override.windows

  return schedule.rules.filter(rule => rule.weekday === (date.dayOfWeek as Weekday))
}

/**
 * Turns dated wall-clock windows into absolute spans.
 *
 * A window whose end is at or before its start closes on the following day, so
 * `22:00`–`02:00` is a six-hour overnight window rather than an empty one.
 */
function resolveWindows(
  schedule: Schedule,
  from: Temporal.PlainDate,
  to: Temporal.PlainDate,
  dst: Required<DstPolicy>
): Span[] {
  const spans: Span[] = []

  // Start a day early: an overnight window opened on the previous evening can
  // still be running when the requested range begins.
  for (let date = from.subtract({ days: 1 }); Temporal.PlainDate.compare(date, to) <= 0; date = date.add({ days: 1 })) {
    for (const window of windowsOn(schedule, date)) {
      const crossesMidnight = window.end <= window.start
      const endDate = crossesMidnight ? date.add({ days: 1 }) : date

      const start = resolve(date, window.start, schedule.timeZone, dst)
      const end = resolve(endDate, window.end, schedule.timeZone, dst)

      if (!start || !end || compare(start, end) >= 0) continue
      spans.push({ start, end })
    }
  }

  return merge(spans)
}

/** Sorts and coalesces overlapping or touching spans. */
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

function overlaps(a: Span, b: Span) {
  return compare(a.start, b.end) < 0 && compare(b.start, a.end) < 0
}

function addMinutes(instant: Temporal.Instant, minutes: number) {
  return instant.add({ minutes })
}

export function getAvailableSlots(query: AvailabilityQuery): Slot[] {
  const {
    schedule,
    eventType,
    bookings = [],
    externalBusy = [],
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
    maxPerDay
  } = eventType

  if (durationMinutes <= 0 || incrementMinutes <= 0) return []

  const reference = Temporal.Instant.from(now)

  // 1–2. Weekly rules and overrides, resolved onto the absolute timeline.
  const windows = resolveWindows(
    schedule,
    Temporal.PlainDate.from(from),
    Temporal.PlainDate.from(to),
    dst
  )

  // 3. Nothing sooner than the notice period, nothing beyond the horizon.
  const opensAt = addMinutes(reference, minimumNoticeMinutes)
  const closesAt = bookingWindowDays === undefined
    ? null
    : reference.toZonedDateTimeISO('UTC').add({ days: bookingWindowDays }).toInstant()

  const commitments = [...bookings, ...externalBusy].map(toSpan)

  // Days already at their cap are removed wholesale rather than slot by slot.
  const bookingsPerDay = new Map<string, number>()
  for (const booking of bookings) {
    const day = Temporal.Instant.from(booking.start)
      .toZonedDateTimeISO(schedule.timeZone)
      .toPlainDate()
      .toString()
    bookingsPerDay.set(day, (bookingsPerDay.get(day) ?? 0) + 1)
  }

  const rangeStart = Temporal.PlainDate.from(from)
  const rangeEnd = Temporal.PlainDate.from(to)

  const slots: Slot[] = []

  for (const window of windows) {
    const opens = latest(window.start, opensAt)
    const closes = closesAt ? earliest(window.end, closesAt) : window.end
    if (compare(opens, closes) >= 0) continue

    /**
     * Candidate starts advance from the window's own opening on the absolute
     * timeline, so a DST transition inside a window shifts the local times
     * rather than corrupting the spacing.
     */
    let cursor = window.start
    while (compare(cursor, opens) < 0) {
      cursor = addMinutes(cursor, incrementMinutes)
    }

    for (; compare(cursor, closes) < 0; cursor = addMinutes(cursor, incrementMinutes)) {
      const slot: Span = { start: cursor, end: addMinutes(cursor, durationMinutes) }

      // 4. The whole meeting has to fit inside the window.
      if (compare(slot.end, closes) > 0) break

      const local = slot.start.toZonedDateTimeISO(schedule.timeZone).toPlainDate()

      // The extra day we expanded for overnight windows may fall outside the
      // caller's range; so may a window truncated by the horizon.
      if (Temporal.PlainDate.compare(local, rangeStart) < 0) continue
      if (Temporal.PlainDate.compare(local, rangeEnd) > 0) continue

      // 6. Daily cap.
      if (maxPerDay !== undefined && (bookingsPerDay.get(local.toString()) ?? 0) >= maxPerDay) {
        continue
      }

      // 5. Buffers protect time around the meeting without being bookable, so
      // the padded span is what must be clear — the slot itself stays exact.
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
