import { cancelPersonalPlan } from '../../services/personal-billing'
import { enforceRateLimit } from '../../services/rate-limit'
import { requireAuthSession } from '../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  await enforceRateLimit(event, {
    namespace: 'personal-billing-cancel',
    identity: session.user.id,
    limit: 5,
    windowSeconds: 300
  })
  return cancelPersonalPlan(session.user.id)
})
