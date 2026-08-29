import { withdrawalCreateInputSchema } from '#shared/payments'
import { createPaymentWithdrawal } from '../../../services/payment-withdrawal'
import { enforceRateLimit } from '../../../services/rate-limit'
import { requireOrganizationPermission } from '../../../services/organization'
import { recordSecurityAudit } from '../../../services/security-audit'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganizationPermission(event, slug, { billing: ['manage'] })
  await enforceRateLimit(event, {
    namespace: 'team-payment-withdrawal-create',
    identity: `${context.organization.id}:${context.userId}`,
    limit: 5,
    windowSeconds: 60 * 60
  })
  const parsed = await readValidatedBody(event, withdrawalCreateInputSchema.safeParse)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'This withdrawal request is invalid. Review it again.' })
  }

  try {
    const withdrawal = await createPaymentWithdrawal({
      owner: { organizationId: context.organization.id },
      actorUserId: context.userId,
      request: parsed.data
    })
    await recordSecurityAudit({
      action: 'payments.withdrawal_requested',
      actorUserId: context.userId,
      actorEmail: context.userEmail,
      organizationId: context.organization.id,
      targetType: 'payment_withdrawal',
      targetId: withdrawal.id,
      metadata: {
        status: withdrawal.status,
        sourceCurrency: withdrawal.sourceCurrency,
        destinationCurrency: withdrawal.destinationCurrency,
        requestedAmountCents: withdrawal.requestedAmountCents
      }
    }, event)
    if (withdrawal.status !== 'completed' && withdrawal.status !== 'failed') setResponseStatus(event, 202)
    return withdrawal
  } catch (error) {
    await recordSecurityAudit({
      action: 'payments.withdrawal_rejected',
      actorUserId: context.userId,
      actorEmail: context.userEmail,
      organizationId: context.organization.id,
      targetType: 'payment_withdrawal',
      targetId: parsed.data.requestId,
      metadata: { reason: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error' }
    }, event)
    throw error
  }
})
