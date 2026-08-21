import { z } from 'zod'
import { findPublicEventType, slotsFor } from '../utils/booking-page'

const query = z.object({
  username: z.string().min(1),
  slug: z.string().min(1),
  from: z.iso.date(),
  to: z.iso.date()
})

export default defineEventHandler(async (event) => {
  const parsed = await getValidatedQuery(event, query.safeParse)

  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid availability request' })
  }

  const { username, slug, from, to } = parsed.data
  const eventType = await findPublicEventType(username, slug)

  if (!eventType) {
    throw createError({ statusCode: 404, statusMessage: 'No such booking page' })
  }

  const slots = await slotsFor(eventType, from, to, new Date().toISOString())

  return {
    timeZone: eventType.scheduleTimeZone ?? eventType.hostTimeZone,
    durationMinutes: eventType.durationMinutes,
    slots
  }
})
