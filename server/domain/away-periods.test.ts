import { Temporal } from '@js-temporal/polyfill'
import { describe, expect, it } from 'vitest'
import { awayPeriodInterval } from './away-periods'

describe('away period calendar boundaries', () => {
  it('includes every selected date from local midnight through the final day', () => {
    expect(awayPeriodInterval({
      startDate: '2026-08-17',
      endDate: '2026-08-19',
      timeZone: 'Africa/Lagos'
    })).toEqual({
      start: '2026-08-16T23:00:00Z',
      end: '2026-08-19T23:00:00Z'
    })
  })

  it('uses timezone calendar arithmetic through a short daylight-saving day', () => {
    const interval = awayPeriodInterval({
      startDate: '2026-03-08',
      endDate: '2026-03-08',
      timeZone: 'America/New_York'
    })

    expect(interval).toEqual({
      start: '2026-03-08T05:00:00Z',
      end: '2026-03-09T04:00:00Z'
    })
    expect(Temporal.Instant.from(interval.start).until(Temporal.Instant.from(interval.end)).total('hours')).toBe(23)
  })

  it('uses timezone calendar arithmetic through a long daylight-saving day', () => {
    const interval = awayPeriodInterval({
      startDate: '2026-11-01',
      endDate: '2026-11-01',
      timeZone: 'America/New_York'
    })

    expect(Temporal.Instant.from(interval.start).until(Temporal.Instant.from(interval.end)).total('hours')).toBe(25)
  })
})
