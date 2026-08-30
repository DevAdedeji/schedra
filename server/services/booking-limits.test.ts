import { describe, expect, it } from 'vitest'
import { reachedBookingLimit } from './booking-limits'

const unlimited = { maxPerDay: null, maxPerWeek: null, maxPerMonth: null }

describe('booking limit enforcement', () => {
  it('counts a shared group occurrence once and permits another seat', () => {
    const period = reachedBookingLimit({
      existing: [
        { bookingId: 'one', groupSessionId: 'session', start: '2026-08-17T08:00:00Z' },
        { bookingId: 'two', groupSessionId: 'session', start: '2026-08-17T08:00:00Z' }
      ],
      proposed: [{ groupSessionId: 'session', start: '2026-08-17T08:00:00Z' }],
      timeZone: 'Africa/Lagos',
      limits: { ...unlimited, maxPerDay: 1 }
    })

    expect(period).toBeNull()
  })

  it('rejects a second distinct host commitment after the daily cap', () => {
    expect(reachedBookingLimit({
      existing: [{ bookingId: 'one', start: '2026-08-17T08:00:00Z' }],
      proposed: [{ start: '2026-08-17T10:00:00Z' }],
      timeZone: 'Africa/Lagos',
      limits: { ...unlimited, maxPerDay: 1 }
    })).toBe('day')
  })

  it('uses local Monday week boundaries across UTC dates', () => {
    expect(reachedBookingLimit({
      existing: [{ bookingId: 'monday-local', start: '2026-08-30T23:30:00Z' }],
      proposed: [{ start: '2026-08-31T12:00:00Z' }],
      timeZone: 'Africa/Lagos',
      limits: { ...unlimited, maxPerWeek: 1 }
    })).toBe('week')
  })

  it('counts all proposed recurring meetings before accepting a series', () => {
    expect(reachedBookingLimit({
      existing: [],
      proposed: [
        { start: '2026-09-07T08:00:00Z' },
        { start: '2026-09-14T08:00:00Z' },
        { start: '2026-09-21T08:00:00Z' }
      ],
      timeZone: 'Africa/Lagos',
      limits: { ...unlimited, maxPerMonth: 2 }
    })).toBe('month')
  })
})
