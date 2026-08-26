import type { AssignmentMode } from '#shared/validation'
import type { Slot } from './types'

export interface HostSlots {
  userId: string
  slots: Slot[]
}

export interface TeamSlot {
  start: string
  end: string
  /** Every host free for this slot, in the order they were supplied. */
  hostIds: string[]
}

/**
 * Combining per-host results rather than computing a joint schedule keeps the
 * single-host engine — buffers, notice, DST, overrides — as the one definition
 * of "free", and makes the team rule a set operation on top of it.
 *
 * Round robin offers a slot when anyone is free; collective only when everyone
 * is, because every required host attends.
 */
export function combineHostSlots(mode: AssignmentMode, hosts: HostSlots[]): TeamSlot[] {
  if (!hosts.length) return []

  const byStart = new Map<string, { end: string, hostIds: string[] }>()

  for (const host of hosts) {
    for (const slot of host.slots) {
      const entry = byStart.get(slot.start)
      if (entry) entry.hostIds.push(host.userId)
      else byStart.set(slot.start, { end: slot.end, hostIds: [host.userId] })
    }
  }

  const required = mode === 'collective' ? hosts.length : 1

  return [...byStart.entries()]
    .filter(([, entry]) => entry.hostIds.length >= required)
    .map(([start, entry]) => ({ start, end: entry.end, hostIds: entry.hostIds }))
    .sort((a, b) => a.start.localeCompare(b.start))
}

export interface HostLoad {
  userId: string
  /** Bookings taken in the recent window used to judge fairness. */
  recentCount: number
  /** When this host was last assigned, or null if never. */
  lastAssignedAt: string | null
}

/**
 * Fairest-first: fewest recent bookings, then longest since last assigned, then
 * a stable tiebreak on id so two simultaneous requests order identically and
 * the loser fails on the exclusion constraint rather than silently doubling up.
 */
export function pickRoundRobinHost(candidates: string[], load: HostLoad[]): string | null {
  if (!candidates.length) return null

  const byUser = new Map(load.map(entry => [entry.userId, entry]))

  return [...candidates].sort((a, b) => {
    const left = byUser.get(a)
    const right = byUser.get(b)

    const counts = (left?.recentCount ?? 0) - (right?.recentCount ?? 0)
    if (counts !== 0) return counts

    const leftLast = left?.lastAssignedAt ?? ''
    const rightLast = right?.lastAssignedAt ?? ''
    if (leftLast !== rightLast) return leftLast.localeCompare(rightLast)

    return a.localeCompare(b)
  })[0] ?? null
}
