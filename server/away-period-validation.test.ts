import { describe, expect, it } from 'vitest'
import { awayPeriodInputSchema } from '#shared/away-periods'

describe('away period validation', () => {
  it('accepts an inclusive date range', () => {
    expect(awayPeriodInputSchema.safeParse({
      name: 'Summer holiday',
      startDate: '2026-08-17',
      endDate: '2026-08-31'
    }).success).toBe(true)
  })

  it('rejects reversed ranges and ranges longer than two years', () => {
    expect(awayPeriodInputSchema.safeParse({
      name: 'Reversed',
      startDate: '2026-08-31',
      endDate: '2026-08-17'
    }).success).toBe(false)
    expect(awayPeriodInputSchema.safeParse({
      name: 'Too long',
      startDate: '2026-01-01',
      endDate: '2028-01-01'
    }).success).toBe(false)
  })
})
