import { payoutBankAccountSchema } from '#shared/payments'
import { savePayoutBankAccount } from '../../../../services/payment-recipient'
import { requireOrganizationPermission } from '../../../../services/organization'
import { enforceRateLimit } from '../../../../services/rate-limit'
import { useEnv } from '../../../../config/env'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganizationPermission(event, slug, { billing: ['manage'] })
  await enforceRateLimit(event, {
    namespace: 'save-team-payout-bank-account',
    identity: context.userId,
    limit: 5,
    windowSeconds: 600
  })
  const parsed = await readValidatedBody(event, payoutBankAccountSchema.safeParse)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Check those bank details.' })
  }
  return {
    ...await savePayoutBankAccount({ organizationId: context.organization.id }, parsed.data),
    platformFeeBps: useEnv().paidBookingPlatformFeeBps
  }
})
