import { z } from 'zod'
import { billingIntervals, collectionCurrencies } from '#shared/billing'
import { bachsConfigured } from '../../integrations/bachs'
import { startPersonalCheckout } from '../../services/personal-billing'
import { enforceRateLimit } from '../../services/rate-limit'
import { requireAuthSession } from '../../services/session'

const bodySchema = z.object({
  interval: z.enum(billingIntervals).default('yearly'),
  currency: z.enum(collectionCurrencies).default('USD'),
  requestId: z.uuid()
})

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  if (!bachsConfigured()) {
    throw createError({ statusCode: 503, statusMessage: 'Billing is not configured on this environment yet.' })
  }
  await enforceRateLimit(event, {
    namespace: 'personal-billing-checkout',
    identity: session.user.id,
    limit: 10,
    windowSeconds: 300
  })
  const parsed = await readValidatedBody(event, bodySchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Choose a valid Personal Pro plan.' })

  return startPersonalCheckout({
    userId: session.user.id,
    interval: parsed.data.interval,
    collectionCurrency: parsed.data.currency,
    requestId: parsed.data.requestId,
    customer: { email: session.user.email, name: session.user.name }
  })
})
