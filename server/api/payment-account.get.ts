import { findPaymentRecipient, publicRecipient, syncPaymentRecipient } from '../services/payment-recipient'
import { requireAuthSession } from '../services/session'
import { useEnv } from '../config/env'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const row = await findPaymentRecipient({ userId: session.user.id })
  const account = !row?.bachsAccountId
    ? publicRecipient(row)
    : await syncPaymentRecipient(row).then(publicRecipient).catch(() => publicRecipient(row))
  return { ...account, platformFeeBps: useEnv().paidBookingPlatformFeeBps }
})
