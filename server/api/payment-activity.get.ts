import { paymentActivityQuerySchema } from '#shared/payment-ledger'
import { listPaymentActivity } from '../services/payment-ledger'
import { requireAuthSession } from '../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const parsed = await getValidatedQuery(event, paymentActivityQuerySchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Choose valid payment activity filters.' })
  return listPaymentActivity({ userId: session.user.id }, session.user.name, parsed.data)
})
