import { withdrawalCreateInputSchema } from '#shared/payments'
import { createPaymentWithdrawal } from '../services/payment-withdrawal'
import { enforceRateLimit } from '../services/rate-limit'
import { requireAuthSession } from '../services/session'
import { recordSecurityAudit } from '../services/security-audit'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  await enforceRateLimit(event, {
    namespace: 'payment-withdrawal-create',
    identity: session.user.id,
    limit: 5,
    windowSeconds: 60 * 60
  })
  const parsed = await readValidatedBody(event, withdrawalCreateInputSchema.safeParse)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'This withdrawal request is invalid. Review it again.' })
  }

  try {
    const withdrawal = await createPaymentWithdrawal({
      owner: { userId: session.user.id },
      actorUserId: session.user.id,
      request: parsed.data
    })
    await recordSecurityAudit({
      action: 'payments.withdrawal_requested',
      actorUserId: session.user.id,
      actorEmail: session.user.email,
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
      actorUserId: session.user.id,
      actorEmail: session.user.email,
      targetType: 'payment_withdrawal',
      targetId: parsed.data.requestId,
      metadata: { reason: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error' }
    }, event)
    throw error
  }
})
