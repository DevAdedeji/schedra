import { withdrawalPreviewInputSchema } from '#shared/payments'
import { previewPaymentWithdrawal } from '../../services/payment-withdrawal'
import { enforceRateLimit } from '../../services/rate-limit'
import { requireAuthSession } from '../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  await enforceRateLimit(event, {
    namespace: 'payment-withdrawal-preview',
    identity: session.user.id,
    limit: 20,
    windowSeconds: 10 * 60
  })
  const parsed = await readValidatedBody(event, withdrawalPreviewInputSchema.safeParse)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Choose a destination and enter a valid withdrawal amount.' })
  }
  return previewPaymentWithdrawal({ userId: session.user.id }, parsed.data)
})
