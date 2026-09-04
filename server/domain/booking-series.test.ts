import { describe, expect, it } from 'vitest'
import { currentSeriesOccurrences } from './booking-series'

describe('recurring request recovery', () => {
  it('returns the latest replacement for each position, including cancelled final occurrences', () => {
    const first = { id: 'one', rescheduledFromId: null, position: 1, status: 'cancelled' }
    const second = { id: 'two', rescheduledFromId: null, position: 2, status: 'confirmed' }
    const moved = { id: 'moved', rescheduledFromId: 'one', position: 1, status: 'cancelled' }
    const movedAgain = { id: 'moved-again', rescheduledFromId: 'moved', position: 1, status: 'cancelled' }
    expect(currentSeriesOccurrences([first, second, moved, movedAgain], 2)).toEqual([movedAgain, second])
  })
  it('rejects missing positions and competing replacement leaves', () => {
    expect(() => currentSeriesOccurrences([{ id: 'one', rescheduledFromId: null, position: 2 }], 1)).toThrow('incomplete')
    expect(() => currentSeriesOccurrences([
      { id: 'one', rescheduledFromId: null, position: 1 },
      { id: 'two', rescheduledFromId: null, position: 1 }
    ], 2)).toThrow('incomplete')
  })
})
