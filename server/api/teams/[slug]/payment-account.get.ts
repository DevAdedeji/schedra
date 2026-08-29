import { findPaymentRecipient, publicRecipient, syncPaymentRecipient, unavailableRecipient } from '../../../services/payment-recipient'
import { requireOrganizationPermission } from '../../../services/organization'
import { useEnv } from '../../../config/env'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganizationPermission(event, slug, { billing: ['manage'] })
  const row = await findPaymentRecipient({ organizationId: context.organization.id })
  const account = !row?.bachsAccountId
    ? publicRecipient(row)
    : await syncPaymentRecipient(row).then(publicRecipient).catch(() => unavailableRecipient(row))
  return { ...account, platformFeeBps: useEnv().paidBookingPlatformFeeBps }
})
