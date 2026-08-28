import { bookingLinkEventOptions } from '../../repositories/booking-links'
import { locationIntegrationReady } from '../../services/event-location'
import { requireAuthSession } from '../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const items = await bookingLinkEventOptions(session.user.id)
  const readiness = new Map(await Promise.all(
    [...new Set(items.map(item => item.locationType))].map(async locationType => [
      locationType,
      await locationIntegrationReady(session.user.id, locationType)
    ] as const)
  ))
  return {
    items: items.map(item => ({
      ...item,
      locationReady: readiness.get(item.locationType) ?? true
    }))
  }
})
