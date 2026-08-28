import { paymentSummary } from '../services/payment-summary'
import { requireAuthSession } from '../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  return paymentSummary({ userId: session.user.id })
})
