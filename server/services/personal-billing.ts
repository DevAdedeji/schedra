import { eq, sql } from 'drizzle-orm'
import type { BillingInterval, CollectionCurrency, OrganizationPlanStatus } from '#shared/billing'
import {
  PERSONAL_PRO_PLAN,
  collectionMethodFor,
  personalProPriceCents,
  toDecimalString
} from '#shared/billing'
import { personalInvoices, personalSubscriptions } from '../database/schema'
import { useDatabase } from '../database'
import {
  cancelSubscription,
  createCheckoutSession,
  createSubscriptionCheckout,
  ensurePersonalProProduct,
  NGN_ONE_TIME_PAYMENT_METHOD_OPTIONS,
  quoteConversion,
  type BachsSubscription
} from '../integrations/bachs'
import { useEnv } from '../config/env'
import { addUtcCalendarPeriod } from '../utils/date-time'
import { personalPlanEntitlement } from './personal-entitlement'
import { recordSecurityAudit } from './security-audit'

function personalPeriodEnd(from: Date, interval: BillingInterval) {
  return addUtcCalendarPeriod(from, interval === 'yearly' ? { years: 1 } : { months: 1 })
}

function assertPublicReturnUrl(base: string) {
  const host = new URL(base).hostname
  if (['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Bachs will not redirect back to localhost. Point SCHEDRA_URL at a public tunnel or use staging to test checkout.'
    })
  }
}

export async function startPersonalCheckout(input: {
  userId: string
  interval: BillingInterval
  collectionCurrency: CollectionCurrency
  requestId: string
  customer: { email: string, name: string }
}) {
  const env = useEnv()
  assertPublicReturnUrl(env.schedraUrl)
  const entitlement = await personalPlanEntitlement(input.userId)
  if (entitlement.isPro) {
    throw createError({
      statusCode: 409,
      statusMessage: entitlement.autoRenews
        ? 'Personal Pro is already active and renews automatically.'
        : 'Personal Pro is already active for the current billing period.'
    })
  }

  const db = useDatabase()
  const reference = `schedra-personal-${input.userId}-${input.requestId}`
  const [existing] = await db.select().from(personalInvoices)
    .where(eq(personalInvoices.reference, reference)).limit(1)
  if (existing?.checkoutUrl && existing.status === 'pending') {
    return { checkoutUrl: existing.checkoutUrl, reference }
  }
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: 'That checkout attempt has already finished. Please start a new one.' })
  }

  const amountCents = personalProPriceCents(input.interval)
  const method = collectionMethodFor(input.collectionCurrency)
  const start = new Date()
  const end = personalPeriodEnd(start, input.interval)
  const successUrl = `${env.schedraUrl}/billing?paid=1`
  const cancelUrl = `${env.schedraUrl}/billing`
  const metadata = {
    userId: input.userId,
    interval: input.interval,
    schedraPlan: 'personal_pro'
  }

  const [invoice] = await db.insert(personalInvoices).values({
    userId: input.userId,
    reference,
    interval: input.interval,
    amountCents,
    collectionCurrency: input.collectionCurrency,
    periodStart: start,
    periodEnd: end
  }).returning({ id: personalInvoices.id })
  if (!invoice) throw createError({ statusCode: 500, statusMessage: 'Could not open an invoice.' })

  const fail = async (failure: unknown): Promise<never> => {
    await db.update(personalInvoices).set({
      status: 'failed',
      lastError: String((failure as { statusMessage?: string })?.statusMessage ?? failure).slice(0, 1000),
      updatedAt: sql`now()`
    }).where(eq(personalInvoices.id, invoice.id))
    throw failure
  }

  if (method === 'charge_automatically') {
    await db.update(personalInvoices)
      .set({ collectionAmount: toDecimalString(amountCents), updatedAt: sql`now()` })
      .where(eq(personalInvoices.id, invoice.id))
  }

  const session = method === 'charge_automatically'
    ? await ensurePersonalProProduct(input.interval)
        .then(productId => createSubscriptionCheckout({
          productId,
          quantity: 1,
          reference,
          customer: input.customer,
          successUrl,
          cancelUrl,
          metadata
        }))
        .catch(fail)
    : await quoteConversion(PERSONAL_PRO_PLAN.currency, input.collectionCurrency, toDecimalString(amountCents))
        .then(async (quote) => {
          await db.update(personalInvoices).set({
            collectionAmount: quote.to_amount,
            exchangeRate: quote.exchange_rate,
            updatedAt: sql`now()`
          }).where(eq(personalInvoices.id, invoice.id))
          return createCheckoutSession({
            amount: quote.to_amount,
            currency: input.collectionCurrency,
            paymentMethodOptions: NGN_ONE_TIME_PAYMENT_METHOD_OPTIONS,
            reference,
            customer: input.customer,
            successUrl,
            cancelUrl,
            metadata: { ...metadata, usdAmount: toDecimalString(amountCents), rate: quote.exchange_rate }
          })
        })
        .catch(fail)

  await db.transaction(async (tx) => {
    await tx.update(personalInvoices).set({
      bachsCheckoutId: session.checkout_id,
      checkoutUrl: session.checkout_url,
      updatedAt: sql`now()`
    }).where(eq(personalInvoices.id, invoice.id))
    await tx.insert(personalSubscriptions).values({
      userId: input.userId,
      status: 'canceled',
      interval: input.interval,
      collectionCurrency: input.collectionCurrency,
      collectionMethod: method,
      lastInvoiceReference: reference
    }).onConflictDoUpdate({
      target: personalSubscriptions.userId,
      set: {
        interval: input.interval,
        collectionCurrency: input.collectionCurrency,
        collectionMethod: method,
        lastInvoiceReference: reference,
        updatedAt: sql`now()`
      }
    })
  })

  await recordSecurityAudit({
    action: 'personal_billing.checkout_opened',
    actorUserId: input.userId,
    targetType: 'personal_invoice',
    targetId: reference,
    metadata: { amountCents, interval: input.interval, currency: input.collectionCurrency, method }
  })

  return { checkoutUrl: session.checkout_url, reference }
}

export async function markPersonalInvoicePaid(input: {
  reference: string
  chargeId?: string | null
  settlementAmountCents?: number | null
}) {
  return useDatabase().transaction(async (tx) => {
    const [invoice] = await tx.select().from(personalInvoices)
      .where(eq(personalInvoices.reference, input.reference))
      .limit(1)
      .for('update')
    if (!invoice) return { applied: false, reason: 'unknown-reference' as const }
    if (invoice.status === 'paid') return { applied: false, reason: 'already-paid' as const, userId: invoice.userId }

    await tx.update(personalInvoices).set({
      status: 'paid',
      paidAt: sql`now()`,
      bachsChargeId: input.chargeId ?? invoice.bachsChargeId,
      settlementAmountCents: input.settlementAmountCents ?? invoice.amountCents,
      updatedAt: sql`now()`
    }).where(eq(personalInvoices.id, invoice.id))

    await tx.insert(personalSubscriptions).values({
      userId: invoice.userId,
      status: 'active',
      interval: invoice.interval,
      collectionCurrency: invoice.collectionCurrency,
      collectionMethod: collectionMethodFor(invoice.collectionCurrency as CollectionCurrency),
      currentPeriodEnd: invoice.periodEnd,
      lastInvoiceReference: invoice.reference
    }).onConflictDoUpdate({
      target: personalSubscriptions.userId,
      set: {
        status: 'active',
        interval: invoice.interval,
        collectionCurrency: invoice.collectionCurrency,
        collectionMethod: collectionMethodFor(invoice.collectionCurrency as CollectionCurrency),
        currentPeriodEnd: invoice.periodEnd,
        graceEndsAt: null,
        cancelAtPeriodEnd: false,
        lastInvoiceReference: invoice.reference,
        updatedAt: sql`now()`
      }
    })
    return { applied: true, reason: 'paid' as const, userId: invoice.userId }
  })
}

export async function markPersonalInvoiceFailed(reference: string, reason: string) {
  const result = await useDatabase().update(personalInvoices).set({
    status: 'failed',
    lastError: reason.slice(0, 1000),
    updatedAt: sql`now()`
  }).where(eq(personalInvoices.reference, reference)).returning({ id: personalInvoices.id })
  return Boolean(result.length)
}

export async function applyPersonalSubscriptionState(subscription: BachsSubscription) {
  const userId = subscription.metadata?.userId
  if (!userId || subscription.metadata?.schedraPlan !== 'personal_pro') {
    return { applied: false, reason: 'not-personal-pro' as const }
  }

  const key = subscription.product?.metadata?.schedra_plan ?? ''
  const interval: BillingInterval = key.endsWith('_monthly')
    || subscription.metadata?.interval === 'monthly'
    ? 'monthly'
    : 'yearly'
  const periodEnd = subscription.current_period_end ?? subscription.next_billed_at
  const status = subscription.status as OrganizationPlanStatus

  await useDatabase().insert(personalSubscriptions).values({
    userId,
    status,
    interval,
    collectionCurrency: 'USD',
    collectionMethod: 'charge_automatically',
    currentPeriodEnd: periodEnd ? new Date(periodEnd) : null,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    bachsSubscriptionId: subscription.id
  }).onConflictDoUpdate({
    target: personalSubscriptions.userId,
    set: {
      status,
      interval,
      collectionCurrency: 'USD',
      collectionMethod: 'charge_automatically',
      currentPeriodEnd: periodEnd ? new Date(periodEnd) : null,
      graceEndsAt: null,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      bachsSubscriptionId: subscription.id,
      updatedAt: sql`now()`
    }
  })
  return { applied: true, reason: 'subscription-updated' as const, userId, status }
}

export async function cancelPersonalPlan(userId: string) {
  const db = useDatabase()
  const [row] = await db.select().from(personalSubscriptions)
    .where(eq(personalSubscriptions.userId, userId)).limit(1)
  if (!row) throw createError({ statusCode: 409, statusMessage: 'Personal Pro is not active.' })

  if (row.collectionMethod === 'invoice' || !row.bachsSubscriptionId) {
    return { cancelAtPeriodEnd: true, currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null, autoRenews: false }
  }

  const updated = await cancelSubscription(row.bachsSubscriptionId, true)
  await db.update(personalSubscriptions).set({
    cancelAtPeriodEnd: true,
    status: updated.status,
    currentPeriodEnd: updated.current_period_end ? new Date(updated.current_period_end) : row.currentPeriodEnd,
    updatedAt: sql`now()`
  }).where(eq(personalSubscriptions.userId, userId))
  await recordSecurityAudit({
    action: 'personal_billing.cancellation_scheduled',
    actorUserId: userId,
    targetType: 'subscription',
    targetId: row.bachsSubscriptionId
  })
  return {
    cancelAtPeriodEnd: true,
    currentPeriodEnd: updated.current_period_end ?? row.currentPeriodEnd?.toISOString() ?? null,
    autoRenews: false
  }
}
