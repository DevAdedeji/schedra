import { findPublicEventType } from '../../../utils/booking-page'
import { enforceRateLimit } from '../../../utils/rate-limit'

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, { namespace: 'booking-page', limit: 180, windowSeconds: 60 })
  const username = getRouterParam(event, 'username')
  const slug = getRouterParam(event, 'slug')

  if (!username || !slug) {
    throw createError({ statusCode: 400, statusMessage: 'Missing booking page' })
  }

  const found = await findPublicEventType(username, slug)

  if (!found) {
    throw createError({ statusCode: 404, statusMessage: 'No such booking page' })
  }

  return {
    hostName: found.hostName,
    title: found.title,
    description: found.description,
    durationMinutes: found.durationMinutes
  }
})
