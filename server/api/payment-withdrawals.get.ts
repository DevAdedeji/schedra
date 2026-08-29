import { paymentWithdrawalOptions } from '../services/payment-withdrawal'
import { requireAuthSession } from '../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  return paymentWithdrawalOptions({ userId: session.user.id })
})
