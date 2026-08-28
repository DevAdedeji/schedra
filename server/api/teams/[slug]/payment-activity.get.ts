import { paymentActivityQuerySchema } from '#shared/payment-ledger'
import { listPaymentActivity } from '../../../services/payment-ledger'
import { requireOrganizationPermission } from '../../../services/organization'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganizationPermission(event, slug, { billing: ['manage'] })
  const parsed = await getValidatedQuery(event, paymentActivityQuerySchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Choose valid payment activity filters.' })
  return listPaymentActivity(
    { organizationId: context.organization.id },
    context.organization.name,
    parsed.data
  )
})
