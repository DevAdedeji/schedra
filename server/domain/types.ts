/** IANA time zone identifier, e.g. `Africa/Lagos`. Never a UTC offset. */
export type TimeZone = string

/** Time of day as `HH:mm`, read in some schedule's own zone. */
export type WallTime = string

/** Calendar date as `YYYY-MM-DD`, read in some schedule's own zone. */
export type IsoDate = string

/** An absolute moment, e.g. `2026-08-18T13:00:00Z`. */
export type IsoInstant = string

/** ISO-8601 numbering, matching `Temporal.PlainDate.dayOfWeek`. */
export const MONDAY = 1
export const SUNDAY = 7
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

export interface WallWindow {
  start: WallTime
  /** At or before `start` means the window closes the next day: 22:00–02:00. */
  end: WallTime
}

export interface AvailabilityRule extends WallWindow {
  weekday: Weekday
}

/** An empty `windows` array blocks the day. */
export interface DateOverride {
  date: IsoDate
  windows: WallWindow[]
}

export interface Schedule {
  timeZone: TimeZone
  rules: AvailabilityRule[]
  overrides?: DateOverride[]
}

/** Half-open, `[start, end)`. */
export interface Interval {
  start: IsoInstant
  end: IsoInstant
}

export interface EventTypeConfig {
  durationMinutes: number
  /** Defaults to `durationMinutes`, giving back-to-back slots. */
  incrementMinutes?: number
  bufferBeforeMinutes?: number
  bufferAfterMinutes?: number
  minimumNoticeMinutes?: number
  bookingWindowDays?: number
  /** Cap on bookings per calendar day, in the schedule's zone. */
  maxPerDay?: number
}

/**
 * DST makes some wall times impossible and others doubled: `01:30` does not
 * exist in London on 2026-03-29, and happens twice in New York on 2026-11-01.
 */
export interface DstPolicy {
  /** `skip` never invents a time the clock did not show. */
  gap?: 'skip' | 'shift'
  ambiguous?: 'earlier' | 'later'
}

export interface AvailabilityQuery {
  schedule: Schedule
  eventType: EventTypeConfig

  /** Blocks time and counts towards `maxPerDay`. */
  bookings?: Interval[]
  /** Blocks time only — a dentist appointment is not one of your meetings. */
  externalBusy?: Interval[]

  /** Inclusive, read in the schedule's zone. */
  from: IsoDate
  to: IsoDate

  now: IsoInstant
  dst?: DstPolicy
}

export type Slot = Interval
