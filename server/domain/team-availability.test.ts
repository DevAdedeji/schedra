import { describe, expect, it } from 'vitest'
import { combineHostSlots, pickRoundRobinHost, type HostSlots } from './team-availability'

const slot = (start: string) => ({ start, end: start })

const ada: HostSlots = { userId: 'ada', slots: [slot('09:00'), slot('10:00')] }
const grace: HostSlots = { userId: 'grace', slots: [slot('10:00'), slot('11:00')] }

describe('combining host availability', () => {
  it('offers a round-robin slot when anybody is free', () => {
    const combined = combineHostSlots('round_robin', [ada, grace])

    expect(combined.map(entry => entry.start)).toEqual(['09:00', '10:00', '11:00'])
    expect(combined.find(entry => entry.start === '10:00')?.hostIds).toEqual(['ada', 'grace'])
    expect(combined.find(entry => entry.start === '09:00')?.hostIds).toEqual(['ada'])
  })

  it('offers a collective slot only when everybody is free', () => {
    const combined = combineHostSlots('collective', [ada, grace])

    expect(combined.map(entry => entry.start)).toEqual(['10:00'])
    expect(combined[0]!.hostIds).toEqual(['ada', 'grace'])
  })

  it('treats a single host the same in both modes', () => {
    expect(combineHostSlots('single', [ada]).map(e => e.start)).toEqual(['09:00', '10:00'])
    expect(combineHostSlots('collective', [ada]).map(e => e.start)).toEqual(['09:00', '10:00'])
  })

  it('has nothing to offer without hosts', () => {
    expect(combineHostSlots('round_robin', [])).toEqual([])
    expect(combineHostSlots('collective', [{ userId: 'ada', slots: [] }])).toEqual([])
  })
})

describe('round-robin fairness', () => {
  it('prefers whoever has taken the fewest recently', () => {
    const chosen = pickRoundRobinHost(['ada', 'grace'], [
      { userId: 'ada', recentCount: 5, lastAssignedAt: '2026-08-01T00:00:00Z' },
      { userId: 'grace', recentCount: 1, lastAssignedAt: '2026-08-20T00:00:00Z' }
    ])

    expect(chosen).toBe('grace')
  })

  it('breaks a tie on who waited longest', () => {
    const chosen = pickRoundRobinHost(['ada', 'grace'], [
      { userId: 'ada', recentCount: 2, lastAssignedAt: '2026-08-01T00:00:00Z' },
      { userId: 'grace', recentCount: 2, lastAssignedAt: '2026-08-20T00:00:00Z' }
    ])

    expect(chosen).toBe('ada')
  })

  it('puts someone never assigned ahead of everyone', () => {
    const chosen = pickRoundRobinHost(['ada', 'zoe'], [
      { userId: 'ada', recentCount: 0, lastAssignedAt: '2026-08-01T00:00:00Z' },
      { userId: 'zoe', recentCount: 0, lastAssignedAt: null }
    ])

    expect(chosen).toBe('zoe')
  })

  it('is deterministic when all assignment history is tied', () => {
    // The booking service serializes the surrounding load-read and write. Once
    // the first request commits, the second sees its assignment and can choose
    // the other host instead of racing on this identical snapshot.
    const load = [
      { userId: 'ada', recentCount: 0, lastAssignedAt: null },
      { userId: 'grace', recentCount: 0, lastAssignedAt: null }
    ]

    expect(pickRoundRobinHost(['ada', 'grace'], load)).toBe('ada')
    expect(pickRoundRobinHost(['grace', 'ada'], load)).toBe('ada')
  })

  it('returns nothing when nobody is free', () => {
    expect(pickRoundRobinHost([], [])).toBeNull()
  })
})
