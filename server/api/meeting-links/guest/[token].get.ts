import { bookingLinkDurationOptions, requireUsableBookingLink } from '../../../services/booking-links'
import { enforceRateLimit } from '../../../services/rate-limit'

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, { namespace: 'booking-invitation', limit: 180, windowSeconds: 60 })
  const token = getRouterParam(event, 'token') ?? ''
  const found = await requireUsableBookingLink(token)
  const durations = bookingLinkDurationOptions(found)
  return {
    username: found.username,
    slug: found.slug,
    hostName: found.hostName,
    title: found.title,
    description: found.description,
    durationMinutes: durations[0] ?? found.durationMinutes,
    durationOptionsMinutes: durations,
    bookingQuestions: found.bookingQuestions,
    requiresConfirmation: found.requiresConfirmation,
    capacity: found.capacity,
    paymentEnabled: found.paymentEnabled,
    priceCents: found.priceCents,
    paymentCurrency: found.paymentCurrency,
    locationType: found.locationType,
    locationDetails: ['google_meet', 'microsoft_teams', 'zoom'].includes(found.locationType)
      ? `A private ${found.locationType === 'zoom' ? 'Zoom' : found.locationType === 'microsoft_teams' ? 'Microsoft Teams' : 'Google Meet'} link will be created when you book.`
      : found.locationType === 'video_link'
        ? 'The meeting link will be shared after you book.'
        : found.locationDetails
  }
})
