import { Temporal } from '@js-temporal/polyfill'
import { describe, expect, it } from 'vitest'
import { getAvailableSlots } from './availability'
import type { AvailabilityQuery, Slot, TimeZone, Weekday } from './types'

const LAGOS = 'Africa/Lagos' // UTC+1 year round, no DST
const LONDON = 'Europe/London'
const NEW_YORK = 'America/New_York'
const LORD_HOWE = 'Australia/Lord_Howe' // 30-minute DST shift
const KATHMANDU = 'Asia/Kathmandu' // UTC+05:45
const CHATHAM = 'Pacific/Chatham' // UTC+12:45 / +13:45

const MONDAY: Weekday = 1
const SUNDAY: Weekday = 7

const A_MONDAY = '2026-08-17'

function query(overrides: Partial<AvailabilityQuery> = {}): AvailabilityQuery {
  const base: AvailabilityQuery = {
    schedule: {
      timeZone: LAGOS,
      rules: [{ weekday: MONDAY, start: '09:00', end: '12:00' }]
    },
    eventType: { durationMinutes: 60 },
    from: A_MONDAY,
    to: A_MONDAY,
    now: '',
    ...overrides
  }

  return {
    ...base,
    now: overrides.now ?? `${Temporal.PlainDate.from(base.from).subtract({ days: 30 })}T00:00:00Z`
  }
}

function localStarts(slots: Slot[], timeZone: TimeZone) {
  return slots.map(slot =>
    Temporal.Instant.from(slot.start)
      .toZonedDateTimeISO(timeZone)
      .toPlainTime()
      .toString()
      .slice(0, 5)
  )
}

function starts(slots: Slot[]) {
  return slots.map(slot => slot.start)
}

describe('slot generation', () => {
  it('lays slots across a weekly window', () => {
    const slots = getAvailableSlots(query())

    expect(starts(slots)).toEqual([
      '2026-08-17T08:00:00Z',
      '2026-08-17T09:00:00Z',
      '2026-08-17T10:00:00Z'
    ])
    expect(localStarts(slots, LAGOS)).toEqual(['09:00', '10:00', '11:00'])
  })

  it('honours an increment finer than the duration', () => {
    const slots = getAvailableSlots(query({
      schedule: { timeZone: LAGOS, rules: [{ weekday: MONDAY, start: '09:00', end: '11:00' }] },
      eventType: { durationMinutes: 60, incrementMinutes: 30 }
    }))

    expect(localStarts(slots, LAGOS)).toEqual(['09:00', '09:30', '10:00'])
  })

  it('never offers a slot that overruns its window', () => {
    const slots = getAvailableSlots(query({
      schedule: { timeZone: LAGOS, rules: [{ weekday: MONDAY, start: '09:00', end: '10:30' }] },
      eventType: { durationMinutes: 60, incrementMinutes: 60 }
    }))

    expect(localStarts(slots, LAGOS)).toEqual(['09:00'])
  })

  it('returns nothing when no rule matches the weekday', () => {
    expect(getAvailableSlots(query({ from: '2026-08-18', to: '2026-08-18' }))).toEqual([])
  })

  it('rejects a non-positive duration rather than looping', () => {
    expect(getAvailableSlots(query({ eventType: { durationMinutes: 0 } }))).toEqual([])
  })
})

describe('date overrides', () => {
  it('replaces the weekly rules for that date', () => {
    const slots = getAvailableSlots(query({
      schedule: {
        timeZone: LAGOS,
        rules: [{ weekday: MONDAY, start: '09:00', end: '17:00' }],
        overrides: [{ date: A_MONDAY, windows: [{ start: '13:00', end: '15:00' }] }]
      }
    }))

    expect(localStarts(slots, LAGOS)).toEqual(['13:00', '14:00'])
  })

  it('blocks the day entirely when the override has no windows', () => {
    const slots = getAvailableSlots(query({
      schedule: {
        timeZone: LAGOS,
        rules: [{ weekday: MONDAY, start: '09:00', end: '17:00' }],
        overrides: [{ date: A_MONDAY, windows: [] }]
      }
    }))

    expect(slots).toEqual([])
  })
})

describe('notice and horizon', () => {
  it('hides slots inside the minimum notice window', () => {
    const slots = getAvailableSlots(query({
      now: '2026-08-17T08:00:00Z', // 09:00 in Lagos, as the window opens
      eventType: { durationMinutes: 60, minimumNoticeMinutes: 120 }
    }))

    expect(localStarts(slots, LAGOS)).toEqual(['11:00'])
  })

  it('offers a slot starting exactly at the notice boundary', () => {
    const slots = getAvailableSlots(query({
      now: '2026-08-17T08:00:00Z',
      eventType: { durationMinutes: 60, minimumNoticeMinutes: 0 }
    }))

    expect(starts(slots)[0]).toBe('2026-08-17T08:00:00Z')
  })

  it('stops at the booking horizon', () => {
    const slots = getAvailableSlots(query({
      schedule: {
        timeZone: LAGOS,
        rules: [
          { weekday: MONDAY, start: '09:00', end: '12:00' },
          { weekday: 2, start: '09:00', end: '12:00' }
        ]
      },
      from: A_MONDAY,
      to: '2026-08-18',
      now: '2026-08-17T00:00:00Z',
      eventType: { durationMinutes: 60, bookingWindowDays: 1 }
    }))

    expect(slots).toHaveLength(3)
    expect(starts(slots).every(start => start.startsWith('2026-08-17'))).toBe(true)
  })
})

describe('collisions and buffers', () => {
  it('removes slots that collide with an existing booking', () => {
    const slots = getAvailableSlots(query({
      bookings: [{ start: '2026-08-17T09:00:00Z', end: '2026-08-17T10:00:00Z' }]
    }))

    expect(localStarts(slots, LAGOS)).toEqual(['09:00', '11:00'])
  })

  it('protects buffer time around neighbouring commitments', () => {
    const slots = getAvailableSlots(query({
      schedule: { timeZone: LAGOS, rules: [{ weekday: MONDAY, start: '09:00', end: '14:00' }] },
      bookings: [{ start: '2026-08-17T10:00:00Z', end: '2026-08-17T11:00:00Z' }],
      eventType: {
        durationMinutes: 60,
        bufferBeforeMinutes: 15,
        bufferAfterMinutes: 15
      }
    }))

    expect(localStarts(slots, LAGOS)).toEqual(['09:00', '13:00'])
  })

  it('offers nothing when buffers swallow the only candidate', () => {
    const slots = getAvailableSlots(query({
      schedule: { timeZone: LAGOS, rules: [{ weekday: MONDAY, start: '09:00', end: '10:00' }] },
      bookings: [{ start: '2026-08-17T07:00:00Z', end: '2026-08-17T08:00:00Z' }],
      eventType: {
        durationMinutes: 60,
        bufferBeforeMinutes: 30,
        bufferAfterMinutes: 30
      }
    }))

    expect(slots).toEqual([])
  })
})

describe('daily cap', () => {
  const busyDay = {
    schedule: { timeZone: LAGOS, rules: [{ weekday: MONDAY, start: '09:00', end: '17:00' }] }
  }

  it('closes a day that has reached its cap', () => {
    const slots = getAvailableSlots(query({
      ...busyDay,
      eventType: { durationMinutes: 60, maxPerDay: 2 },
      bookings: [
        { start: '2026-08-17T08:00:00Z', end: '2026-08-17T09:00:00Z' },
        { start: '2026-08-17T09:00:00Z', end: '2026-08-17T10:00:00Z' }
      ]
    }))

    expect(slots).toEqual([])
  })

  it('counts only real bookings, not external calendar busy time', () => {
    const slots = getAvailableSlots(query({
      ...busyDay,
      eventType: { durationMinutes: 60, maxPerDay: 2 },
      externalBusy: [
        { start: '2026-08-17T08:00:00Z', end: '2026-08-17T09:00:00Z' },
        { start: '2026-08-17T09:00:00Z', end: '2026-08-17T10:00:00Z' }
      ]
    }))

    expect(slots.length).toBeGreaterThan(0)
    expect(localStarts(slots, LAGOS)).not.toContain('09:00')
    expect(localStarts(slots, LAGOS)).not.toContain('10:00')
  })
})

describe('overlapping rules', () => {
  it('coalesces overlapping windows instead of duplicating slots', () => {
    const slots = getAvailableSlots(query({
      schedule: {
        timeZone: LAGOS,
        rules: [
          { weekday: MONDAY, start: '09:00', end: '12:00' },
          { weekday: MONDAY, start: '11:00', end: '14:00' }
        ]
      }
    }))

    expect(localStarts(slots, LAGOS)).toEqual(['09:00', '10:00', '11:00', '12:00', '13:00'])
    expect(new Set(starts(slots)).size).toBe(slots.length)
  })

  it('joins windows that merely touch', () => {
    const slots = getAvailableSlots(query({
      schedule: {
        timeZone: LAGOS,
        rules: [
          { weekday: MONDAY, start: '09:00', end: '11:00' },
          { weekday: MONDAY, start: '11:00', end: '13:00' }
        ]
      },
      eventType: { durationMinutes: 120 }
    }))

    expect(localStarts(slots, LAGOS)).toEqual(['09:00', '11:00'])
  })
})

describe('windows crossing midnight', () => {
  it('treats an end at or before the start as running into the next day', () => {
    const slots = getAvailableSlots(query({
      schedule: { timeZone: LAGOS, rules: [{ weekday: MONDAY, start: '22:00', end: '02:00' }] },
      from: A_MONDAY,
      to: '2026-08-18'
    }))

    expect(localStarts(slots, LAGOS)).toEqual(['22:00', '23:00', '00:00', '01:00'])
    expect(starts(slots)[0]).toBe('2026-08-17T21:00:00Z')
  })

  it('keeps only the slots whose own local date is inside the range', () => {
    const slots = getAvailableSlots(query({
      schedule: { timeZone: LAGOS, rules: [{ weekday: MONDAY, start: '22:00', end: '02:00' }] },
      from: A_MONDAY,
      to: A_MONDAY
    }))

    expect(localStarts(slots, LAGOS)).toEqual(['22:00', '23:00'])
  })
})

describe('DST — spring forward', () => {
  it('never offers a wall-clock time the gap deleted', () => {
    const slots = getAvailableSlots(query({
      schedule: { timeZone: LONDON, rules: [{ weekday: SUNDAY, start: '00:00', end: '04:00' }] },
      eventType: { durationMinutes: 30 },
      from: '2026-03-29',
      to: '2026-03-29'
    }))

    expect(localStarts(slots, LONDON)).toEqual(['00:00', '00:30', '02:00', '02:30', '03:00', '03:30'])
    expect(localStarts(slots, LONDON).some(time => time.startsWith('01:'))).toBe(false)
  })

  it('skips the correct hour for the zone', () => {
    const slots = getAvailableSlots(query({
      schedule: { timeZone: NEW_YORK, rules: [{ weekday: SUNDAY, start: '01:00', end: '04:00' }] },
      eventType: { durationMinutes: 60 },
      from: '2026-03-08',
      to: '2026-03-08'
    }))

    expect(localStarts(slots, NEW_YORK)).toEqual(['01:00', '03:00'])
  })

  it('drops a window whose boundary falls inside the gap', () => {
    const slots = getAvailableSlots(query({
      schedule: { timeZone: LONDON, rules: [{ weekday: SUNDAY, start: '01:30', end: '05:00' }] },
      eventType: { durationMinutes: 30 },
      from: '2026-03-29',
      to: '2026-03-29'
    }))

    expect(slots).toEqual([])
  })

  it('shifts a window past the gap when asked to', () => {
    const slots = getAvailableSlots(query({
      schedule: { timeZone: LONDON, rules: [{ weekday: SUNDAY, start: '01:30', end: '05:00' }] },
      eventType: { durationMinutes: 30 },
      from: '2026-03-29',
      to: '2026-03-29',
      dst: { gap: 'shift' }
    }))

    expect(localStarts(slots, LONDON)).toEqual(['02:30', '03:00', '03:30', '04:00', '04:30'])
  })

  it('handles a thirty-minute transition', () => {
    const slots = getAvailableSlots(query({
      schedule: { timeZone: LORD_HOWE, rules: [{ weekday: SUNDAY, start: '01:00', end: '04:00' }] },
      eventType: { durationMinutes: 30 },
      from: '2026-10-04',
      to: '2026-10-04'
    }))

    expect(localStarts(slots, LORD_HOWE)).toEqual(['01:00', '01:30', '02:30', '03:00', '03:30'])
  })
})

describe('DST — fall back', () => {
  it('offers the repeated hour twice, as distinct instants', () => {
    const slots = getAvailableSlots(query({
      schedule: { timeZone: NEW_YORK, rules: [{ weekday: SUNDAY, start: '00:00', end: '03:00' }] },
      eventType: { durationMinutes: 60 },
      from: '2026-11-01',
      to: '2026-11-01'
    }))

    expect(localStarts(slots, NEW_YORK)).toEqual(['00:00', '01:00', '01:00', '02:00'])
    expect(starts(slots)).toEqual([
      '2026-11-01T04:00:00Z',
      '2026-11-01T05:00:00Z',
      '2026-11-01T06:00:00Z',
      '2026-11-01T07:00:00Z'
    ])
    expect(new Set(starts(slots)).size).toBe(4)
  })

  it('resolves an ambiguous window boundary to the earlier pass by default', () => {
    const slots = getAvailableSlots(query({
      schedule: { timeZone: NEW_YORK, rules: [{ weekday: SUNDAY, start: '01:30', end: '04:00' }] },
      eventType: { durationMinutes: 60 },
      from: '2026-11-01',
      to: '2026-11-01'
    }))

    expect(starts(slots)[0]).toBe('2026-11-01T05:30:00Z') // 01:30 at -04:00
    expect(slots).toHaveLength(3)
  })

  it('can resolve an ambiguous boundary to the later pass', () => {
    const slots = getAvailableSlots(query({
      schedule: { timeZone: NEW_YORK, rules: [{ weekday: SUNDAY, start: '01:30', end: '04:00' }] },
      eventType: { durationMinutes: 60 },
      from: '2026-11-01',
      to: '2026-11-01',
      dst: { ambiguous: 'later' }
    }))

    expect(starts(slots)[0]).toBe('2026-11-01T06:30:00Z') // 01:30 at -05:00
    expect(slots).toHaveLength(2)
  })
})

describe('offsets that are not whole hours', () => {
  it('handles UTC+05:45', () => {
    const slots = getAvailableSlots(query({
      schedule: { timeZone: KATHMANDU, rules: [{ weekday: MONDAY, start: '09:00', end: '10:00' }] }
    }))

    expect(starts(slots)).toEqual(['2026-08-17T03:15:00Z'])
  })

  it('handles UTC+12:45 and its +13:45 summer offset', () => {
    const winter = getAvailableSlots(query({
      schedule: { timeZone: CHATHAM, rules: [{ weekday: MONDAY, start: '09:00', end: '10:00' }] },
      from: '2026-07-13',
      to: '2026-07-13'
    }))

    const summer = getAvailableSlots(query({
      schedule: { timeZone: CHATHAM, rules: [{ weekday: MONDAY, start: '09:00', end: '10:00' }] },
      from: '2026-01-12',
      to: '2026-01-12'
    }))

    expect(starts(winter)).toEqual(['2026-07-12T20:15:00Z'])
    expect(starts(summer)).toEqual(['2026-01-11T19:15:00Z'])
  })
})

describe('cross-zone bookings', () => {
  it('returns absolute instants, leaving the viewer zone a display concern', () => {
    const slots = getAvailableSlots(query({
      schedule: { timeZone: LAGOS, rules: [{ weekday: MONDAY, start: '09:00', end: '10:00' }] }
    }))

    expect(starts(slots)).toEqual(['2026-08-17T08:00:00Z'])
    expect(localStarts(slots, LAGOS)).toEqual(['09:00'])
    expect(localStarts(slots, NEW_YORK)).toEqual(['04:00'])
    expect(localStarts(slots, KATHMANDU)).toEqual(['13:45'])
  })
})
