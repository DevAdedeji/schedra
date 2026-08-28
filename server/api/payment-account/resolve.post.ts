import { payoutBankAccountSchema } from '#shared/payments'
import { resolvePayoutBankAccount } from '../../services/payment-recipient'
import { enforceRateLimit } from '../../services/rate-limit'
import { requireAuthSession } from '../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  await enforceRateLimit(event, {
    namespace: 'resolve-payout-bank-account',
    identity: session.user.id,
    limit: 10,
    windowSeconds: 600
  })
  const parsed = await readValidatedBody(event, payoutBankAccountSchema.safeParse)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Check those bank details.' })
  }
  return resolvePayoutBankAccount({ userId: session.user.id }, parsed.data)
})
