import { createPaymentOnboarding } from '../../../services/payment-recipient'
import { enforceRateLimit } from '../../../services/rate-limit'
import { requireOrganizationPermission } from '../../../services/organization'
import { recordSecurityAudit } from '../../../services/security-audit'

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, { namespace: 'team-payment-onboarding', limit: 3, windowSeconds: 600 })
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganizationPermission(event, slug, { billing: ['manage'] })
  const onboarding = await createPaymentOnboarding({
    owner: { organizationId: context.organization.id },
    email: context.userEmail,
    name: context.organization.name,
    representativeName: context.userName,
    returnPath: `/t/${encodeURIComponent(context.organization.slug)}/payments`
  })
  await recordSecurityAudit({
    action: 'payments.onboarding_link_created',
    actorUserId: context.userId,
    actorEmail: context.userEmail,
    organizationId: context.organization.id,
    targetType: 'payment_recipient',
    targetId: context.organization.id,
    metadata: { ownerType: 'organization' }
  }, event)
  return onboarding
})
