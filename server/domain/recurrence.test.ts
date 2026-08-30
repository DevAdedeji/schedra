import { describe, expect, it } from 'vitest'
import {
  RecurrenceGenerationError,
  recurringOccurrences,
  weeklyRecurringOccurrences
} from '#shared/recurrence'
import { commonRecurringHostIds, recurringOccurrenceAvailability } from './recurrence'

describe('recurring occurrence generation', () => {
  it('keeps the same local time each week', () => {
    const occurrences = weeklyRecurringOccurrences({
      start: '2026-08-17T09:00:00Z',
      timeZone: 'Africa/Lagos',
      durationMinutes: 30,
      occurrences: 3
    })

    expect(occurrences).toEqual([
      { position: 1, startsAt: '2026-08-17T09:00:00Z', endsAt: '2026-08-17T09:30:00Z' },
      { position: 2, startsAt: '2026-08-24T09:00:00Z', endsAt: '2026-08-24T09:30:00Z' },
      { position: 3, startsAt: '2026-08-31T09:00:00Z', endsAt: '2026-08-31T09:30:00Z' }
    ])
  })

  it('preserves wall-clock time across a daylight-saving change', () => {
    const occurrences = weeklyRecurringOccurrences({
      start: '2026-02-23T14:00:00Z',
      timeZone: 'America/New_York',
      durationMinutes: 60,
      occurrences: 3
    })

    expect(occurrences.map(item => item.startsAt)).toEqual([
      '2026-02-23T14:00:00Z',
      '2026-03-02T14:00:00Z',
      '2026-03-09T13:00:00Z'
    ])
  })

  it('supports every two weeks', () => {
    const occurrences = recurringOccurrences({
      start: '2026-08-17T09:00:00Z',
      timeZone: 'Africa/Lagos',
      durationMinutes: 30,
      occurrences: 3,
      frequency: 'biweekly'
    })

    expect(occurrences.map(item => item.startsAt)).toEqual([
      '2026-08-17T09:00:00Z',
      '2026-08-31T09:00:00Z',
      '2026-09-14T09:00:00Z'
    ])
  })

  it('constrains monthly dates from the original anchor without drifting', () => {
    const occurrences = recurringOccurrences({
      start: '2027-01-31T15:00:00Z',
      timeZone: 'UTC',
      durationMinutes: 60,
      occurrences: 3,
      frequency: 'monthly'
    })

    expect(occurrences.map(item => item.startsAt)).toEqual([
      '2027-01-31T15:00:00Z',
      '2027-02-28T15:00:00Z',
      '2027-03-31T15:00:00Z'
    ])
  })

  it('constrains leap-day yearly occurrences in non-leap years', () => {
    const occurrences = recurringOccurrences({
      start: '2024-02-29T10:00:00Z',
      timeZone: 'UTC',
      durationMinutes: 45,
      occurrences: 3,
      frequency: 'yearly'
    })

    expect(occurrences.map(item => item.startsAt)).toEqual([
      '2024-02-29T10:00:00Z',
      '2025-02-28T10:00:00Z',
      '2026-02-28T10:00:00Z'
    ])
  })

  it('rejects a future wall-clock time deleted by daylight saving', () => {
    expect(() => weeklyRecurringOccurrences({
      start: '2026-03-01T07:30:00Z',
      timeZone: 'America/New_York',
      durationMinutes: 30,
      occurrences: 2
    })).toThrowError(RecurrenceGenerationError)

    try {
      weeklyRecurringOccurrences({
        start: '2026-03-01T07:30:00Z',
        timeZone: 'America/New_York',
        durationMinutes: 30,
        occurrences: 2
      })
    } catch (error) {
      expect(error).toMatchObject({ position: 2, code: 'invalid_recurring_local_time' })
    }
  })
})

describe('recurring availability', () => {
  const occurrences = weeklyRecurringOccurrences({
    start: '2026-08-17T09:00:00Z',
    timeZone: 'Africa/Lagos',
    durationMinutes: 30,
    occurrences: 3
  })

  it('requires both the start and end of every offered slot to match', () => {
    const preview = recurringOccurrenceAvailability(occurrences, [
      { start: occurrences[0]!.startsAt, end: occurrences[0]!.endsAt },
      { start: occurrences[1]!.startsAt, end: '2026-08-24T10:00:00Z' }
    ])

    expect(preview.map(item => item.available)).toEqual([true, false, false])
  })

  it('returns only hosts available for the complete series', () => {
    const offered = occurrences.map((occurrence, index) => ({
      start: occurrence.startsAt,
      end: occurrence.endsAt,
      hostIds: index === 1 ? ['host-b', 'host-c'] : ['host-a', 'host-b']
    }))

    expect(commonRecurringHostIds(occurrences, offered)).toEqual(['host-b'])
  })

  it('returns no host when one occurrence has no matching slot', () => {
    expect(commonRecurringHostIds(occurrences, [{
      start: occurrences[0]!.startsAt,
      end: occurrences[0]!.endsAt,
      hostIds: ['host-a']
    }])).toEqual([])
  })
})
