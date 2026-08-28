import { analyticsQuerySchema } from '#shared/analytics'
import { getBookingAnalytics } from '../services/analytics'
import { requireAuthSession } from '../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const parsed = await getValidatedQuery(event, analyticsQuerySchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Choose a valid analytics range.' })
  return getBookingAnalytics({ userId: session.user.id }, parsed.data)
})
