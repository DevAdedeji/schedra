import { z } from 'zod'
import { activeHostsFor, findPublicTeamEventType, teamSlotsFor } from '../utils/team-booking-page'
import { enforceRateLimit } from '../utils/rate-limit'
import { CalendarUnavailableError } from '../utils/google-calendar'

const query = z.object({
  team: z.string().min(1),
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
  // Each request fans out across every host, so this is rate limited harder
  // than the single-host equivalent.
  await enforceRateLimit(event, { namespace: 'team-availability', limit: 60, windowSeconds: 60 })
  const parsed = await getValidatedQuery(event, query.safeParse)

  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid availability request' })
  }

  const { team, slug, from, to } = parsed.data
  const eventType = await findPublicTeamEventType(team, slug)
  if (!eventType) throw createError({ statusCode: 404, statusMessage: 'No such booking page' })

  const hosts = await activeHostsFor(eventType.id)

  try {
    const slots = await teamSlotsFor(eventType, hosts, from, to, new Date().toISOString())

    return {
      timeZone: hosts[0]?.scheduleTimeZone ?? 'UTC',
      durationMinutes: eventType.durationMinutes,
      assignmentMode: eventType.assignmentMode,
      // Which hosts are free is deliberately not exposed: a guest picking a time
      // has no business learning who on the team is busy.
      slots: slots.map(slot => ({ start: slot.start, end: slot.end }))
    }
  } catch (error) {
    if (error instanceof CalendarUnavailableError) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Booking times are temporarily unavailable. Please try again shortly.'
      })
    }
    throw error
  }
})
