import type { RecurringOccurrence, RecurringOccurrencePreview } from '#shared/recurrence'

export interface OfferedRecurringSlot {
  start: string
  end: string
}

export interface OfferedRecurringTeamSlot extends OfferedRecurringSlot {
  hostIds: string[]
}

function instantKey(value: string) {
  return new Date(value).getTime()
}

function slotKey(start: string, end: string) {
  return `${instantKey(start)}:${instantKey(end)}`
}

export function recurringOccurrenceAvailability(
  occurrences: RecurringOccurrence[],
  offeredSlots: OfferedRecurringSlot[]
): RecurringOccurrencePreview[] {
  const offered = new Set(offeredSlots.map(slot => slotKey(slot.start, slot.end)))
  return occurrences.map(occurrence => ({
    ...occurrence,
    available: offered.has(slotKey(occurrence.startsAt, occurrence.endsAt))
  }))
}

export function commonRecurringHostIds(
  occurrences: RecurringOccurrence[],
  offeredSlots: OfferedRecurringTeamSlot[]
) {
  const slots = new Map(offeredSlots.map(slot => [slotKey(slot.start, slot.end), slot]))
  const first = slots.get(slotKey(occurrences[0]?.startsAt ?? '', occurrences[0]?.endsAt ?? ''))
  if (!first) return []

  return first.hostIds.filter(hostId => occurrences.every((occurrence) => {
    const slot = slots.get(slotKey(occurrence.startsAt, occurrence.endsAt))
    return slot?.hostIds.includes(hostId)
  }))
}
