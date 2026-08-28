import { paymentActivityQuerySchema } from '#shared/payment-ledger'
import { listOperationsPaymentActivity } from '../../services/payment-ledger'
import { requirePlatformAdminSession } from '../../services/session'

export default defineEventHandler(async (event) => {
  await requirePlatformAdminSession(event)
  const parsed = await getValidatedQuery(event, paymentActivityQuerySchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Choose valid payment activity filters.' })
  return listOperationsPaymentActivity(parsed.data)
})
