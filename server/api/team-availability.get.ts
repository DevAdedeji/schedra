import { z } from 'zod'
import { activeHostsFor, findPublicTeamEventType, teamSlotsFor } from '../services/team-booking'
import { enforceRateLimit } from '../services/rate-limit'
import { CalendarUnavailableError } from '../integrations/calendar/google'
import { requireTeamLocationIntegrations } from '../services/event-location'

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
    await requireTeamLocationIntegrations(
      (eventType.locationType === 'zoom' && eventType.assignmentMode === 'collective'
        ? hosts.slice(0, 1)
        : hosts).map(host => host.userId),
      eventType.locationType
    )
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
    if (error instanceof CalendarUnavailableError || (
      ['google_meet', 'zoom'].includes(eventType.locationType)
      && (error as { statusCode?: number }).statusCode === 409
    )) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Booking times are temporarily unavailable. Please try again shortly.'
      })
    }
    throw error
  }
})
