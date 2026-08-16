/**
 * Domain vocabulary for the availability engine.
 *
 * Two rules govern everything here:
 *
 * 1. Recurring availability is stored as **wall-clock time plus an IANA zone**
 *    (`09:00` + `Africa/Lagos`), never as a fixed UTC offset. A zone's offset
 *    changes twice a year; the zone itself does not.
 *
 * 2. Anything that has already happened or been committed is an **instant** on
 *    the absolute timeline, carried as an ISO 8601 string in UTC.
 *
 * Confusing the two is the root of essentially every scheduling bug.
 */

/** IANA time zone identifier, e.g. `Africa/Lagos`. Never a UTC offset. */
export type TimeZone = string

/** Time of day as `HH:mm`, read in some schedule's own zone. */
export type WallTime = string

/** Calendar date as `YYYY-MM-DD`, read in some schedule's own zone. */
export type IsoDate = string

/** An absolute moment as an ISO 8601 string, e.g. `2026-08-18T13:00:00Z`. */
export type IsoInstant = string

/** ISO-8601 weekday numbering, matching `Temporal.PlainDate.dayOfWeek`. */
export const MONDAY = 1
export const SUNDAY = 7
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

/** A half-open wall-clock window, `[start, end)`. */
export interface WallWindow {
  start: WallTime
  /**
   * When `end` is less than or equal to `start` the window crosses midnight and
   * closes on the following day — `22:00` to `02:00` is a six-hour window.
   */
  end: WallTime
}

/** One recurring weekly window of availability. */
export interface AvailabilityRule extends WallWindow {
  weekday: Weekday
}

/**
 * A single date that ignores the weekly rules entirely. An empty `windows`
 * array blocks the day — that is how holidays and time off are expressed.
 */
export interface DateOverride {
  date: IsoDate
  windows: WallWindow[]
}

export interface Schedule {
  timeZone: TimeZone
  rules: AvailabilityRule[]
  overrides?: DateOverride[]
}

/** A half-open interval on the absolute timeline, `[start, end)`. */
export interface Interval {
  start: IsoInstant
  end: IsoInstant
}

export interface EventTypeConfig {
  durationMinutes: number

  /**
   * Spacing of candidate start times. Defaults to `durationMinutes`, which
   * yields back-to-back slots; set it smaller for a denser grid.
   */
  incrementMinutes?: number

  /** Protected time either side of the meeting. Blocks slots, is not bookable. */
  bufferBeforeMinutes?: number
  bufferAfterMinutes?: number

  /** How soon from `now` a booking may start. */
  minimumNoticeMinutes?: number

  /** How far from `now` bookings may be made, in days. */
  bookingWindowDays?: number

  /** Cap on confirmed bookings per calendar day, in the schedule's zone. */
  maxPerDay?: number
}

/**
 * How to resolve wall-clock times that DST makes impossible or doubled.
 *
 * On a spring-forward day a wall time can be skipped entirely (`01:30` does not
 * exist in London on 2026-03-29). On a fall-back day it can occur twice
 * (`01:30` happens at both -04:00 and -05:00 in New York on 2026-11-01).
 */
export interface DstPolicy {
  /**
   * `skip` drops a window whose boundary falls in the gap — we never invent a
   * time the clock did not show. `shift` moves it forward past the gap.
   */
  gap?: 'skip' | 'shift'

  /** Which of the two occurrences a doubled wall time refers to. */
  ambiguous?: 'earlier' | 'later'
}

export interface AvailabilityQuery {
  schedule: Schedule
  eventType: EventTypeConfig

  /**
   * Confirmed Schedra bookings. These block time *and* count towards
   * `maxPerDay`.
   */
  bookings?: Interval[]

  /**
   * Busy time pulled from connected calendars. Blocks time but does not count
   * towards `maxPerDay` — a dentist appointment is not one of your meetings.
   */
  externalBusy?: Interval[]

  /** Inclusive range of dates to search, read in the schedule's zone. */
  from: IsoDate
  to: IsoDate

  /** Reference point for notice and booking-window limits. */
  now: IsoInstant

  dst?: DstPolicy
}

/** A bookable slot. Both ends are absolute instants. */
export type Slot = Interval
