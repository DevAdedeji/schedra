import { describe, expect, it } from 'vitest'
import { fillDailySeries, percentage, percentageChange } from '#shared/analytics'

describe('analytics calculations', () => {
  it('calculates rates and comparable period changes without division errors', () => {
    expect(percentage(1, 4)).toBe(25)
    expect(percentage(1, 0)).toBe(0)
    expect(percentageChange(15, 10)).toBe(50)
    expect(percentageChange(3, 0)).toBeNull()
    expect(percentageChange(0, 0)).toBe(0)
  })

  it('fills days without bookings so charts have a stable timeline', () => {
    const result = fillDailySeries(new Date('2026-08-01T00:00:00Z'), 3, [
      { date: '2026-08-02', value: 4 }
    ])
    expect(result).toEqual([
      { date: '2026-08-01', value: 0 },
      { date: '2026-08-02', value: 4 },
      { date: '2026-08-03', value: 0 }
    ])
  })
})
