import { z } from 'zod'
import { activeHostsFor, findPublicTeamEventType, teamSlotsFor } from '../services/team-booking'
import { enforceRateLimit } from '../services/rate-limit'
import { CalendarUnavailableError } from '../integrations/calendar/google'
import { requireTeamLocationIntegrations } from '../services/event-location'
import { calendarDaysBetween } from '../utils/date-time'
import { bookingToReschedule } from '../services/booking-reschedule'

const query = z.object({
  team: z.string().min(1),
  slug: z.string().min(1),
  from: z.iso.date(),
  to: z.iso.date(),
  durationMinutes: z.coerce.number().int().min(5).max(720).optional(),
  rescheduleOf: z.uuid().optional()
}).superRefine(({ from, to }, context) => {
  const days = calendarDaysBetween(from, to)

  if (days < 0) {
    context.addIssue({ code: 'custom', path: ['to'], message: 'End date must not be before start date' })
  } else if (days > 62) {
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

  const { team, slug, from, to, durationMinutes, rescheduleOf } = parsed.data
  const eventType = await findPublicTeamEventType(team, slug)
  if (!eventType) throw createError({ statusCode: 404, statusMessage: 'No such booking page' })

  const hosts = await activeHostsFor(eventType.id)
  const previous = await bookingToReschedule(rescheduleOf, eventType.id)

  try {
    await requireTeamLocationIntegrations(
      (eventType.locationType === 'zoom' && eventType.assignmentMode === 'collective'
        ? hosts.slice(0, 1)
        : hosts).map(host => host.userId),
      eventType.locationType
    )
    const slots = await teamSlotsFor(eventType, hosts, from, to, new Date().toISOString(), durationMinutes, [], previous?.id)

    return {
      timeZone: hosts[0]?.scheduleTimeZone ?? 'UTC',
      durationMinutes: durationMinutes ?? eventType.durationMinutes,
      assignmentMode: eventType.assignmentMode,
      // Which hosts are free is deliberately not exposed: a guest picking a time
      // has no business learning who on the team is busy.
      slots: slots.map(slot => ({
        start: slot.start,
        end: slot.end,
        ...(slot.availableSeats === undefined ? {} : { availableSeats: slot.availableSeats })
      }))
    }
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
})
