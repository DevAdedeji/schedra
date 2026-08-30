import { Temporal } from '@js-temporal/polyfill'
import type { Interval } from './types'

export interface CalendarDateRange {
  startDate: string
  endDate: string
  timeZone: string
}

export function awayPeriodInterval(period: CalendarDateRange): Interval {
  const midnight = Temporal.PlainTime.from('00:00')
  const start = Temporal.PlainDate.from(period.startDate)
    .toZonedDateTime({ timeZone: period.timeZone, plainTime: midnight })
    .toInstant()
  const end = Temporal.PlainDate.from(period.endDate)
    .add({ days: 1 })
    .toZonedDateTime({ timeZone: period.timeZone, plainTime: midnight })
    .toInstant()

  return { start: start.toString(), end: end.toString() }
}
