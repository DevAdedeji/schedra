import { Temporal } from '@js-temporal/polyfill'
import { z } from 'zod'

export const MIN_RECURRING_OCCURRENCES = 2
export const MAX_RECURRING_OCCURRENCES = 8
export const DEFAULT_RECURRING_OCCURRENCES = 4

export const recurringBookingFrequencySchema = z.enum(['weekly', 'biweekly', 'monthly', 'yearly'])

export const recurringBookingRequestSchema = z.object({
  frequency: recurringBookingFrequencySchema,
  occurrences: z.number().int().min(MIN_RECURRING_OCCURRENCES).max(MAX_RECURRING_OCCURRENCES)
}).strict()

export const recurringBookingSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  maxOccurrences: z.number().int().min(MIN_RECURRING_OCCURRENCES).max(MAX_RECURRING_OCCURRENCES)
    .default(MAX_RECURRING_OCCURRENCES)
}).strict()

export type RecurringBookingRequest = z.infer<typeof recurringBookingRequestSchema>
export type RecurringBookingSettings = z.infer<typeof recurringBookingSettingsSchema>
export type RecurringBookingFrequency = z.infer<typeof recurringBookingFrequencySchema>

export interface RecurringOccurrence {
  position: number
  startsAt: string
  endsAt: string
}

export interface RecurringOccurrencePreview extends RecurringOccurrence {
  available: boolean
}

export class RecurrenceGenerationError extends Error {
  readonly code = 'invalid_recurring_local_time'

  constructor(
    public readonly position: number,
    public readonly localDateTime: string
  ) {
    super(`Occurrence ${position} falls on a local time that does not exist or is ambiguous.`)
    this.name = 'RecurrenceGenerationError'
  }
}

function recurringInstant(
  anchor: Temporal.ZonedDateTime,
  period: Pick<Temporal.DurationLike, 'weeks' | 'months' | 'years'>,
  position: number
) {
  if (!period.weeks && !period.months && !period.years) return anchor.toInstant()

  // Derive every date from the original anchor. This makes Jan 31 recur on
  // Feb 28 and then Mar 31 instead of drifting permanently to the 28th.
  const local = anchor.toPlainDateTime().add(period, { overflow: 'constrain' })
  try {
    return Temporal.ZonedDateTime.from({
      timeZone: anchor.timeZoneId,
      year: local.year,
      month: local.month,
      day: local.day,
      hour: local.hour,
      minute: local.minute,
      second: local.second,
      millisecond: local.millisecond,
      microsecond: local.microsecond,
      nanosecond: local.nanosecond
    }, { disambiguation: 'reject' }).toInstant()
  } catch {
    throw new RecurrenceGenerationError(position, local.toString())
  }
}

export function recurringOccurrences(input: {
  start: string
  timeZone: string
  durationMinutes: number
  occurrences: number
  frequency: RecurringBookingFrequency
}): RecurringOccurrence[] {
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0) {
    throw new RangeError('Duration must be a positive whole number of minutes.')
  }
  if (!Number.isInteger(input.occurrences)
    || input.occurrences < MIN_RECURRING_OCCURRENCES
    || input.occurrences > MAX_RECURRING_OCCURRENCES) {
    throw new RangeError(`A recurring booking must contain between ${MIN_RECURRING_OCCURRENCES} and ${MAX_RECURRING_OCCURRENCES} meetings.`)
  }

  const anchor = Temporal.Instant.from(input.start).toZonedDateTimeISO(input.timeZone)

  return Array.from({ length: input.occurrences }, (_, index) => {
    const position = index + 1
    const period = {
      weekly: { weeks: index },
      biweekly: { weeks: index * 2 },
      monthly: { months: index },
      yearly: { years: index }
    }[input.frequency]
    const start = recurringInstant(anchor, period, position)
    return {
      position,
      startsAt: start.toString(),
      endsAt: start.add({ minutes: input.durationMinutes }).toString()
    }
  })
}

export function weeklyRecurringOccurrences(input: Omit<Parameters<typeof recurringOccurrences>[0], 'frequency'>) {
  return recurringOccurrences({ ...input, frequency: 'weekly' })
}
