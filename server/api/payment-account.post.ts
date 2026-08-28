import { createPaymentOnboarding } from '../services/payment-recipient'
import { enforceRateLimit } from '../services/rate-limit'
import { requireAuthSession } from '../services/session'

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, { namespace: 'payment-onboarding', limit: 6, windowSeconds: 600 })
  const session = await requireAuthSession(event)
  return createPaymentOnboarding({
    owner: { userId: session.user.id },
    email: session.user.email,
    name: session.user.name,
    returnPath: '/payments'
  })
})
