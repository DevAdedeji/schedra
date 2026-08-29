import { withdrawalPreviewInputSchema } from '#shared/payments'
import { previewPaymentWithdrawal } from '../../../../services/payment-withdrawal'
import { enforceRateLimit } from '../../../../services/rate-limit'
import { requireOrganizationPermission } from '../../../../services/organization'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganizationPermission(event, slug, { billing: ['manage'] })
  await enforceRateLimit(event, {
    namespace: 'team-payment-withdrawal-preview',
    identity: `${context.organization.id}:${context.userId}`,
    limit: 20,
    windowSeconds: 10 * 60
  })
  const parsed = await readValidatedBody(event, withdrawalPreviewInputSchema.safeParse)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Choose a destination and enter a valid withdrawal amount.' })
  }
  return previewPaymentWithdrawal({ organizationId: context.organization.id }, parsed.data)
})
