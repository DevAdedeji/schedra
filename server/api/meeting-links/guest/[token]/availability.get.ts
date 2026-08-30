import { z } from 'zod'
import { bookingLinkDurationOptions, filterInvitationSlots, requireUsableBookingLink } from '../../../../services/booking-links'
import { slotsFor } from '../../../../services/booking-page'
import { enforceRateLimit } from '../../../../services/rate-limit'
import { requireLocationIntegration } from '../../../../services/event-location'
import { calendarDaysBetween } from '../../../../utils/date-time'

const querySchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  durationMinutes: z.coerce.number().int().min(5).max(720).optional()
})
  .superRefine(({ from, to }, context) => {
    const days = calendarDaysBetween(from, to)
    if (days < 0) {
      context.addIssue({ code: 'custom', path: ['to'], message: 'End date must not be before start date.' })
    } else if (days > 62) {
      context.addIssue({ code: 'custom', path: ['to'], message: 'Availability range cannot exceed 63 days.' })
    }
  })

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, { namespace: 'invitation-availability', limit: 120, windowSeconds: 60 })
  const parsed = await getValidatedQuery(event, querySchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid availability request.' })
  const link = await requireUsableBookingLink(getRouterParam(event, 'token') ?? '')
  await requireLocationIntegration(link.hostId, link.locationType)
  const durationMinutes = parsed.data.durationMinutes ?? bookingLinkDurationOptions(link)[0] ?? link.durationMinutes
  const slots = await slotsFor(link, parsed.data.from, parsed.data.to, new Date().toISOString(), durationMinutes)
  return {
    timeZone: link.scheduleTimeZone ?? link.hostTimeZone,
    durationMinutes,
    slots: filterInvitationSlots(link, slots)
  }
})
