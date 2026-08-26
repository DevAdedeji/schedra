import { requireOrganizationPermission } from '../../../../services/organization'
import { enforceRateLimit } from '../../../../services/rate-limit'
import { enqueueSubscriptionSeatSync } from '../../../../services/subscription-seat-sync'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganizationPermission(event, slug, { billing: ['manage'] })

  await enforceRateLimit(event, {
    namespace: 'billing-seat-sync',
    identity: context.userId,
    limit: 5,
    windowSeconds: 60
  })

  await enqueueSubscriptionSeatSync(context.organization.id)
  return { queued: true }
})
