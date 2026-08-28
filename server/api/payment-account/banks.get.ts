import { payoutBanks } from '../../services/payment-recipient'
import { requireAuthSession } from '../../services/session'

export default defineEventHandler(async (event) => {
  await requireAuthSession(event)
  setResponseHeader(event, 'Cache-Control', 'private, max-age=3600')
  return { items: await payoutBanks() }
})
