import { findPublicEventType } from '../../../services/booking-page'
import { enforceRateLimit } from '../../../services/rate-limit'

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
    durationMinutes: found.durationMinutes,
    bookingQuestions: found.bookingQuestions,
    requiresConfirmation: found.requiresConfirmation,
    locationType: found.locationType,
    locationDetails: found.locationType === 'google_meet'
      ? 'A private Google Meet link will be created when you book.'
      : found.locationType === 'video_link'
        ? 'The meeting link will be shared after you book.'
        : found.locationDetails
  }
})
