import { createHash } from 'node:crypto'
import type { RecurringBookingRequest, RecurringOccurrencePreview } from '#shared/recurrence'
import { recurringOccurrences } from '#shared/recurrence'
import { eventTypeDurationOptions } from '#shared/validation'
import { commonRecurringHostIds } from '../domain/recurrence'
import type { TeamSlot } from '../domain/team-availability'
import { addUtcCalendarDays, utcCalendarDate } from '../utils/date-time'
import { slotsFor } from './booking-page'
import type { EventTypeRow } from './booking-page'
import { teamSlotsFor } from './team-booking'
import type { ActiveHost, TeamEventTypeRow } from './team-booking'

export function requireRecurringConfiguration(eventType: {
  recurringBookingEnabled: boolean
  recurringBookingMaxOccurrences: number
  paymentEnabled: boolean
  requiresConfirmation: boolean
  capacity: number
  durationMinutes: number
  additionalDurationMinutes: number[]
}, recurrence: RecurringBookingRequest, durationMinutes: number) {
  if (!eventType.recurringBookingEnabled) {
    throw createError({ statusCode: 400, statusMessage: 'This event does not offer recurring bookings.' })
  }
  if (eventType.paymentEnabled || eventType.requiresConfirmation || eventType.capacity !== 1) {
    throw createError({ statusCode: 409, statusMessage: 'Recurring bookings are unavailable for this event configuration.' })
  }
  if (recurrence.occurrences > eventType.recurringBookingMaxOccurrences) {
    throw createError({ statusCode: 400, statusMessage: `Choose no more than ${eventType.recurringBookingMaxOccurrences} meetings.` })
  }
  if (!eventTypeDurationOptions(eventType).includes(durationMinutes)) {
    throw createError({ statusCode: 400, statusMessage: 'Choose one of the offered meeting durations.' })
  }
}

export function recurringRequestFingerprint(input: Record<string, unknown>) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

function occurrenceDates(start: string) {
  const date = utcCalendarDate(Date.parse(start))
  return { from: addUtcCalendarDays(date, -1), to: addUtcCalendarDays(date, 1) }
}

function exactSlot<T extends { start: string, end: string }>(
  slots: T[], occurrence: { startsAt: string, endsAt: string }
) {
  const start = Date.parse(occurrence.startsAt)
  const end = Date.parse(occurrence.endsAt)
  return slots.find(slot => Date.parse(slot.start) === start && Date.parse(slot.end) === end)
}

export async function personalRecurringAvailability(input: {
  eventType: EventTypeRow
  firstStart: string
  timeZone: string
  durationMinutes: number
  recurrence: RecurringBookingRequest
  now?: string
}): Promise<RecurringOccurrencePreview[]> {
  requireRecurringConfiguration(input.eventType, input.recurrence, input.durationMinutes)
  const occurrences = recurringOccurrences({
    start: input.firstStart,
    timeZone: input.timeZone,
    durationMinutes: input.durationMinutes,
    ...input.recurrence
  })
  const now = input.now ?? new Date().toISOString()
  return Promise.all(occurrences.map(async (occurrence, index): Promise<RecurringOccurrencePreview> => {
    const range = occurrenceDates(occurrence.startsAt)
    const slots = await slotsFor(
      input.eventType,
      range.from,
      range.to,
      now,
      input.durationMinutes,
      occurrences.slice(0, index).map(item => ({ start: item.startsAt, end: item.endsAt }))
    )
    return { ...occurrence, available: Boolean(exactSlot(slots, occurrence)) }
  }))
}

export async function teamRecurringAvailability(input: {
  eventType: TeamEventTypeRow
  hosts: ActiveHost[]
  firstStart: string
  timeZone: string
  durationMinutes: number
  recurrence: RecurringBookingRequest
  now?: string
}) {
  requireRecurringConfiguration(input.eventType, input.recurrence, input.durationMinutes)
  const occurrences = recurringOccurrences({
    start: input.firstStart,
    timeZone: input.timeZone,
    durationMinutes: input.durationMinutes,
    ...input.recurrence
  })
  const now = input.now ?? new Date().toISOString()
  const matched: Array<TeamSlot | null> = await Promise.all(occurrences.map(async (occurrence, index) => {
    const range = occurrenceDates(occurrence.startsAt)
    const slots = await teamSlotsFor(
      input.eventType,
      input.hosts,
      range.from,
      range.to,
      now,
      input.durationMinutes,
      occurrences.slice(0, index).map(item => ({ start: item.startsAt, end: item.endsAt }))
    )
    return exactSlot(slots, occurrence) ?? null
  }))
  const offered = matched.filter((slot): slot is NonNullable<typeof slot> => Boolean(slot))
  const commonHostIds = offered.length === occurrences.length
    ? commonRecurringHostIds(occurrences, offered)
    : []
  return {
    occurrences: occurrences.map((occurrence, index) => ({
      ...occurrence,
      available: Boolean(matched[index]) && commonHostIds.length > 0
    })),
    commonHostIds
  }
}
