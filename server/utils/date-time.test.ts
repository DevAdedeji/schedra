import { describe, expect, it } from 'vitest'
import {
  addCalendarDateDays,
  addExactTime,
  calendarDateKey,
  calendarDaysBetween as appCalendarDaysBetween,
  formatCalendarDate,
  startOfIsoWeek
} from '../../app/utils/date-time'
import {
  addToInstant,
  addUtcCalendarDays,
  addUtcCalendarPeriod,
  calendarDaysBetween,
  subtractFromInstant,
  unixSeconds,
  utcCalendarDate,
  utcCalendarDateBoundary
} from './date-time'

describe('calendar date utilities', () => {
  it('uses calendar arithmetic across leap days and DST boundaries', () => {
    expect(addCalendarDateDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addUtcCalendarDays('2026-03-07', 2)).toBe('2026-03-09')
    expect(appCalendarDaysBetween('2026-03-07', '2026-03-09')).toBe(2)
    expect(calendarDaysBetween('2026-03-07', '2026-03-09')).toBe(2)
  })

  it('finds ISO week boundaries without depending on the machine timezone', () => {
    expect(startOfIsoWeek('2026-08-30')).toBe('2026-08-24')
    expect(formatCalendarDate('2026-08-30', { weekday: 'long', month: 'long', day: 'numeric' }, 'en'))
      .toBe('Sunday, August 30')
  })

  it('derives calendar dates in the requested timezone', () => {
    const instant = '2026-01-01T00:30:00Z'
    expect(calendarDateKey(instant, 'America/New_York')).toBe('2025-12-31')
    expect(calendarDateKey(instant, 'Africa/Lagos')).toBe('2026-01-01')
    expect(utcCalendarDate(instant)).toBe('2026-01-01')
  })

  it('creates explicit UTC date boundaries', () => {
    expect(utcCalendarDateBoundary('2026-01-01', -1).toISOString()).toBe('2025-12-31T00:00:00.000Z')
  })
})

describe('instant utilities', () => {
  it('adds and subtracts exact durations', () => {
    const value = '2026-08-29T00:00:00Z'
    expect(addExactTime(value, { minutes: 90 }).toISOString()).toBe('2026-08-29T01:30:00.000Z')
    expect(addToInstant(value, { seconds: 30 }).toISOString()).toBe('2026-08-29T00:00:30.000Z')
    expect(subtractFromInstant(value, { hours: 2 }).toISOString()).toBe('2026-08-28T22:00:00.000Z')
    expect(unixSeconds('1970-01-01T00:01:30Z')).toBe(90)
  })

  it('uses constrained calendar arithmetic for billing periods', () => {
    expect(addUtcCalendarPeriod('2027-01-31T10:15:00Z', { months: 1 }).toISOString())
      .toBe('2027-02-28T10:15:00.000Z')
    expect(addUtcCalendarPeriod('2028-02-29T10:15:00Z', { years: 1 }).toISOString())
      .toBe('2029-02-28T10:15:00.000Z')
  })
})
