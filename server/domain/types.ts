export type TimeZone = string

export type WallTime = string

export type IsoDate = string

export type IsoInstant = string

export const MONDAY = 1
export const SUNDAY = 7
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

export interface WallWindow {
  start: WallTime
  end: WallTime
}

export interface AvailabilityRule extends WallWindow {
  weekday: Weekday
}

export interface DateOverride {
  date: IsoDate
  windows: WallWindow[]
}

export interface Schedule {
  timeZone: TimeZone
  rules: AvailabilityRule[]
  overrides?: DateOverride[]
}

export interface Interval {
  start: IsoInstant
  end: IsoInstant
}

export interface EventTypeConfig {
  durationMinutes: number
  incrementMinutes?: number
  bufferBeforeMinutes?: number
  bufferAfterMinutes?: number
  minimumNoticeMinutes?: number
  bookingWindowDays?: number
  maxPerDay?: number
}

export interface DstPolicy {
  gap?: 'skip' | 'shift'
  ambiguous?: 'earlier' | 'later'
}

export interface AvailabilityQuery {
  schedule: Schedule
  eventType: EventTypeConfig

  bookings?: Interval[]
  externalBusy?: Interval[]

  from: IsoDate
  to: IsoDate

  now: IsoInstant
  dst?: DstPolicy
}

export type Slot = Interval
