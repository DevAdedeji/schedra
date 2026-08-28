import { bookingLinksQuerySchema } from '#shared/booking-links'
import { listBookingLinks } from '../../services/booking-links'
import { requireAuthSession } from '../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const parsed = await getValidatedQuery(event, bookingLinksQuerySchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid meeting-link filters.' })
  return listBookingLinks(session.user.id, parsed.data)
})
