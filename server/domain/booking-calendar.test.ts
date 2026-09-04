import { describe, expect, it } from 'vitest'
import { Temporal } from '@js-temporal/polyfill'
import { bookingCalendarRange, lastBookingCalendarWeek } from '../../shared/booking-calendar'

describe('public booking calendar pagination', () => {
  it('loads a fresh bounded page after eight weeks rather than stopping at nine', () => {
    expect(bookingCalendarRange('2026-09-07', 0)).toEqual({ from: '2026-09-05', to: '2026-11-03' })
    expect(bookingCalendarRange('2026-09-07', 7)).toEqual(bookingCalendarRange('2026-09-07', 0))
    expect(bookingCalendarRange('2026-09-07', 8)).toEqual({ from: '2026-10-31', to: '2026-12-29' })
  })

  it('keeps requests below the API limit across year, leap-day, and distant pages', () => {
    for (const start of ['2026-12-28', '2028-02-28']) {
      for (const offset of [0, 8, 20, 52, 522]) {
        const range = bookingCalendarRange(start, offset)
        expect(Temporal.PlainDate.from(range.from).until(Temporal.PlainDate.from(range.to)).days).toBe(59)
      }
    }
  })

  it('honors short, extended, and unlimited host booking windows', () => {
    const now = '2026-09-09T12:00Z'
    expect(lastBookingCalendarWeek('2026-09-07', now, 1)).toBe(0)
    expect(lastBookingCalendarWeek('2026-09-07', now, 180)).toBe(26)
    expect(lastBookingCalendarWeek('2026-09-07', now, null)).toBe(Infinity)
    expect(lastBookingCalendarWeek('2026-09-07', now, undefined)).toBe(Infinity)
  })

  it('allows the last visible week when the cutoff crosses into Monday in the viewer zone', () => {
    const now = '2026-09-12T23:00Z'
    expect(lastBookingCalendarWeek('2026-09-07', now, 1, 'UTC')).toBe(0)
    expect(lastBookingCalendarWeek('2026-09-07', now, 1, 'Pacific/Kiritimati')).toBe(1)
  })
})
