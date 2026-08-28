import { z } from 'zod'
import { findOwnedEventType } from '../../../repositories/booking-links'
import { slotsFor } from '../../../services/booking-page'
import { requireAuthSession } from '../../../services/session'

const querySchema = z.object({
  from: z.iso.date(),
  to: z.iso.date()
}).superRefine(({ from, to }, context) => {
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
  if (days < 0 || days > 30) context.addIssue({ code: 'custom', message: 'Choose a range of at most 31 days.' })
})

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  const query = await getValidatedQuery(event, querySchema.safeParse)
  if (!id.success || !query.success) throw createError({ statusCode: 400, statusMessage: 'Invalid availability request.' })
  const eventType = await findOwnedEventType(session.user.id, id.data)
  if (!eventType) throw createError({ statusCode: 404, statusMessage: 'No such event type.' })
  const slots = await slotsFor(eventType, query.data.from, query.data.to, new Date().toISOString())
  return { timeZone: eventType.scheduleTimeZone ?? eventType.hostTimeZone, durationMinutes: eventType.durationMinutes, slots }
})
