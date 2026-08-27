import { z } from 'zod'
import { findPublicEventType, slotsFor } from '../services/booking-page'
import { enforceRateLimit } from '../services/rate-limit'
import { CalendarUnavailableError } from '../integrations/calendar/google'
import { requireLocationIntegration } from '../services/event-location'

const query = z.object({
  username: z.string().min(1),
  slug: z.string().min(1),
  from: z.iso.date(),
  to: z.iso.date()
}).superRefine(({ from, to }, context) => {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)

  if (end < start) {
    context.addIssue({ code: 'custom', path: ['to'], message: 'End date must not be before start date' })
  } else if ((end - start) / 86_400_000 > 62) {
    context.addIssue({ code: 'custom', path: ['to'], message: 'Availability range cannot exceed 63 days' })
  }
})

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, { namespace: 'availability', limit: 120, windowSeconds: 60 })
  const parsed = await getValidatedQuery(event, query.safeParse)

  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid availability request' })
  }

  const { username, slug, from, to } = parsed.data
  const eventType = await findPublicEventType(username, slug)

  if (!eventType) {
    throw createError({ statusCode: 404, statusMessage: 'No such booking page' })
  }

  let slots
  try {
    await requireLocationIntegration(eventType.hostId, eventType.locationType)
    slots = await slotsFor(eventType, from, to, new Date().toISOString())
  } catch (error) {
    if (error instanceof CalendarUnavailableError || (
      ['google_meet', 'microsoft_teams', 'zoom'].includes(eventType.locationType)
      && (error as { statusCode?: number }).statusCode === 409
    )) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Booking times are temporarily unavailable. Please try again shortly.'
      })
    }
    throw error
  }

  return {
    timeZone: eventType.scheduleTimeZone ?? eventType.hostTimeZone,
    durationMinutes: eventType.durationMinutes,
    slots
  }
})
