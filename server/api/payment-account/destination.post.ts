import { payoutBankAccountSchema } from '#shared/payments'
import { savePayoutBankAccount } from '../../services/payment-recipient'
import { enforceRateLimit } from '../../services/rate-limit'
import { requireAuthSession } from '../../services/session'
import { useEnv } from '../../config/env'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  await enforceRateLimit(event, {
    namespace: 'save-payout-bank-account',
    identity: session.user.id,
    limit: 5,
    windowSeconds: 600
  })
  const parsed = await readValidatedBody(event, payoutBankAccountSchema.safeParse)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Check those bank details.' })
  }
  return {
    ...await savePayoutBankAccount({ userId: session.user.id }, parsed.data),
    platformFeeBps: useEnv().paidBookingPlatformFeeBps
  }
})
