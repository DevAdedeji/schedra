import { z } from 'zod'
import { recurringBookingRequestSchema } from '#shared/recurrence'
import { timeZoneSchema } from '#shared/validation'
import { findPublicEventType } from '../services/booking-page'
import { activeHostsFor, findPublicTeamEventType } from '../services/team-booking'
import { personalRecurringAvailability, teamRecurringAvailability } from '../services/recurring-booking'
import { enforceRateLimit } from '../services/rate-limit'
import { CalendarUnavailableError } from '../integrations/calendar/google'

const schema = z.object({
  mode: z.enum(['personal', 'team']),
  owner: z.string().trim().min(1).max(64),
  slug: z.string().trim().min(1).max(64),
  start: z.iso.datetime(),
  durationMinutes: z.number().int().min(5).max(720),
  timeZone: timeZoneSchema,
  recurrence: recurringBookingRequestSchema
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, { namespace: 'recurrence-preview', limit: 30, windowSeconds: 60 })
  const parsed = await readValidatedBody(event, schema.safeParse)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Invalid recurring booking preview.' })
  }
  const input = parsed.data
  try {
    if (input.mode === 'personal') {
      const eventType = await findPublicEventType(input.owner, input.slug)
      if (!eventType) throw createError({ statusCode: 404, statusMessage: 'No such booking page' })
      return {
        occurrences: await personalRecurringAvailability({
          eventType,
          firstStart: input.start,
          timeZone: input.timeZone,
          durationMinutes: input.durationMinutes,
          recurrence: input.recurrence
        })
      }
    }

    const eventType = await findPublicTeamEventType(input.owner, input.slug)
    if (!eventType) throw createError({ statusCode: 404, statusMessage: 'No such booking page' })
    const hosts = await activeHostsFor(eventType.id)
    if (!hosts.length) throw createError({ statusCode: 409, statusMessage: 'This team event has no available hosts right now.' })
    const preview = await teamRecurringAvailability({
      eventType,
      hosts,
      firstStart: input.start,
      timeZone: input.timeZone,
      durationMinutes: input.durationMinutes,
      recurrence: input.recurrence
    })
    return { occurrences: preview.occurrences }
  } catch (error) {
    if (error instanceof CalendarUnavailableError) {
      throw createError({ statusCode: 503, statusMessage: 'Recurring dates are temporarily unavailable. Please try again shortly.' })
    }
    throw error
  }
})
