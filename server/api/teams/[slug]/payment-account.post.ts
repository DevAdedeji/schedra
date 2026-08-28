import { createPaymentOnboarding } from '../../../services/payment-recipient'
import { enforceRateLimit } from '../../../services/rate-limit'
import { requireOrganizationPermission } from '../../../services/organization'

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, { namespace: 'team-payment-onboarding', limit: 6, windowSeconds: 600 })
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganizationPermission(event, slug, { billing: ['manage'] })
  return createPaymentOnboarding({
    owner: { organizationId: context.organization.id },
    email: context.userEmail,
    name: context.organization.name,
    returnPath: `/t/${encodeURIComponent(context.organization.slug)}/payments`
  })
})
