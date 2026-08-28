import { payoutBankAccountSchema } from '#shared/payments'
import { resolvePayoutBankAccount } from '../../../../services/payment-recipient'
import { requireOrganizationPermission } from '../../../../services/organization'
import { enforceRateLimit } from '../../../../services/rate-limit'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganizationPermission(event, slug, { billing: ['manage'] })
  await enforceRateLimit(event, {
    namespace: 'resolve-team-payout-bank-account',
    identity: context.userId,
    limit: 10,
    windowSeconds: 600
  })
  const parsed = await readValidatedBody(event, payoutBankAccountSchema.safeParse)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Check those bank details.' })
  }
  return resolvePayoutBankAccount({ organizationId: context.organization.id }, parsed.data)
})
