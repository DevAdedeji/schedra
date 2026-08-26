import { z } from 'zod'
import { billingIntervals, collectionCurrencies } from '#shared/billing'
import { bachsConfigured } from '../../../../integrations/bachs'
import { startCheckout } from '../../../../services/billing'
import { requireOrganizationPermission } from '../../../../services/organization'
import { enforceRateLimit } from '../../../../services/rate-limit'

const bodySchema = z.object({
  interval: z.enum(billingIntervals).default('yearly'),
  currency: z.enum(collectionCurrencies).default('USD')
})

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const context = await requireOrganizationPermission(event, slug, { billing: ['manage'] })

  if (!bachsConfigured()) {
    throw createError({ statusCode: 503, statusMessage: 'Billing is not configured on this environment yet.' })
  }

  // Opening a checkout costs a Bachs call and writes an invoice row, so it is
  // rate limited per caller rather than left open to hammering.
  await enforceRateLimit(event, {
    namespace: 'billing-checkout',
    identity: context.userId,
    limit: 10,
    windowSeconds: 300
  })

  const parsed = await readValidatedBody(event, bodySchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Choose a valid plan.' })

  const session = await startCheckout({
    organizationId: context.organization.id,
    organizationName: context.organization.name,
    organizationSlug: context.organization.slug,
    interval: parsed.data.interval,
    collectionCurrency: parsed.data.currency,
    customer: { email: context.userEmail, name: context.organization.name },
    actorUserId: context.userId
  })

  return session
})
