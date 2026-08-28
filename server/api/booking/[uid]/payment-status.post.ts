import { enforceRateLimit } from '../../../services/rate-limit'
import { reconcilePaidBooking } from '../../../services/paid-booking'

export default defineEventHandler(async (event) => {
  const uid = getRouterParam(event, 'uid')
  if (!uid) throw createError({ statusCode: 400, statusMessage: 'Missing booking' })

  await enforceRateLimit(event, {
    namespace: 'paid-booking-reconciliation',
    identity: uid,
    limit: 12,
    windowSeconds: 60
  })

  return reconcilePaidBooking(uid)
})
