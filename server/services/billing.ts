import { eq, sql } from 'drizzle-orm'
import type { BillingInterval, CollectionCurrency, OrganizationPlanStatus } from '#shared/billing'
import {
  TEAM_PLAN,
  billingCheckoutReason,
  billableSeats,
  collectionMethodFor,
  invoiceTotalCents,
  toDecimalString
} from '#shared/billing'
import { organizationInvoices, organizationSubscriptions } from '../database/schema'
import { useDatabase } from '../database'
import {
  createCheckoutSession,
  createSubscriptionCheckout,
  ensureTeamProduct,
  NGN_ONE_TIME_PAYMENT_METHOD_OPTIONS,
  quoteConversion,
  type BachsSubscription
} from '../integrations/bachs'
import { organizationEntitlement } from './entitlement'
import { recordAudit } from './organization'
import { enqueueSubscriptionSeatSync } from './subscription-seat-sync'
import { useEnv } from '../config/env'

// Bachs rejects NGN checkouts below ₦1,000. Even the smallest one-seat team
// invoice is far above that after USD-to-NGN conversion.
function periodEnd(from: Date, interval: BillingInterval) {
  const end = new Date(from)
  if (interval === 'yearly') end.setUTCFullYear(end.getUTCFullYear() + 1)
  else end.setUTCMonth(end.getUTCMonth() + 1)
  return end
}

/**
 * The reference is both our primary key for the invoice and the Bachs
 * idempotency key, so a retried checkout can never create a second charge.
 */
function invoiceReference(organizationId: string, periodStart: Date) {
  return `schedra-team-${organizationId}-${periodStart.toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`
}

/**
 * Bachs refuses a localhost redirect, so a developer would otherwise meet an
 * opaque VALIDATION_ERROR from the provider instead of a useful instruction.
 */
function assertPublicReturnUrl(base: string) {
  const host = new URL(base).hostname
  if (['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Bachs will not redirect back to localhost. Point SCHEDRA_URL at a public tunnel or use staging to test checkout.'
    })
  }
}

export async function startCheckout(input: {
  organizationId: string
  organizationName: string
  organizationSlug: string
  interval: BillingInterval
  collectionCurrency: CollectionCurrency
  customer: { email: string, name: string }
  actorUserId: string
}) {
  const env = useEnv()
  assertPublicReturnUrl(env.schedraUrl)

  const db = useDatabase()
  const entitlement = await organizationEntitlement(input.organizationId)

  const seats = billableSeats(entitlement.seatsUsed)
  const [currentSubscription] = await db.select({
    collectionMethod: organizationSubscriptions.collectionMethod,
    seatsAtLastInvoice: organizationSubscriptions.seatsAtLastInvoice
  }).from(organizationSubscriptions)
    .where(eq(organizationSubscriptions.organizationId, input.organizationId))
    .limit(1)

  const currentMethod = currentSubscription?.collectionMethod === 'charge_automatically'
    ? 'charge_automatically'
    : 'invoice'
  const checkoutReason = billingCheckoutReason(
    entitlement.status,
    currentMethod,
    (currentSubscription?.seatsAtLastInvoice ?? 0) !== seats
  )
  if (!checkoutReason) {
    throw createError({
      statusCode: 409,
      statusMessage: entitlement.status === 'active'
        ? 'This subscription is already active and renews automatically.'
        : 'Bachs is already handling payment recovery for this subscription.'
    })
  }

  const amountCents = invoiceTotalCents(entitlement.seatsUsed, input.interval)
  const method = collectionMethodFor(input.collectionCurrency)
  const start = new Date()
  const end = periodEnd(start, input.interval)
  const reference = invoiceReference(input.organizationId, start)

  const successUrl = `${env.schedraUrl}/t/${input.organizationSlug}/billing?paid=1`
  const cancelUrl = `${env.schedraUrl}/t/${input.organizationSlug}/billing`
  const metadata = {
    organizationId: input.organizationId,
    interval: input.interval,
    seats: String(seats)
  }

  const [invoice] = await db.insert(organizationInvoices).values({
    organizationId: input.organizationId,
    reference,
    interval: input.interval,
    seats,
    amountCents,
    collectionCurrency: input.collectionCurrency,
    periodStart: start,
    periodEnd: end
  }).returning({ id: organizationInvoices.id })

  if (!invoice) throw createError({ statusCode: 500, statusMessage: 'Could not open an invoice.' })

  const fail = async (failure: unknown): Promise<never> => {
    await db.update(organizationInvoices)
      .set({
        status: 'failed',
        lastError: String((failure as { statusMessage?: string })?.statusMessage ?? failure),
        updatedAt: sql`now()`
      })
      .where(eq(organizationInvoices.id, invoice.id))
    throw failure
  }

  // The USD path records what was charged too, so both paths reconcile the same way.
  if (method === 'charge_automatically') {
    await db.update(organizationInvoices)
      .set({ collectionAmount: toDecimalString(amountCents), updatedAt: sql`now()` })
      .where(eq(organizationInvoices.id, invoice.id))
  }

  const session = method === 'charge_automatically'
    // USD by card: a recurring product makes Bachs open the session in
    // subscription mode and bill the saved card every period from then on.
    ? await ensureTeamProduct(input.interval, seats)
        .then(productId => createSubscriptionCheckout({
          productId,
          // Bachs cannot mutate subscription quantity yet. The product itself
          // represents the complete occupied-seat price, so quantity stays one.
          quantity: 1,
          reference,
          customer: input.customer,
          successUrl,
          cancelUrl,
          metadata
        }))
        .catch(fail)
    // NGN is bank transfer, which subscriptions do not support, so each period
    // is a one-off charge the team chooses to pay. Bachs refuses to bill a
    // USD-priced checkout in NGN, so it has to be priced in NGN outright.
    : await quoteConversion(TEAM_PLAN.currency, input.collectionCurrency, toDecimalString(amountCents))
        .then(async (quote) => {
          await db.update(organizationInvoices)
            .set({
              collectionAmount: quote.to_amount,
              exchangeRate: quote.exchange_rate,
              updatedAt: sql`now()`
            })
            .where(eq(organizationInvoices.id, invoice.id))

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

  await db.update(organizationInvoices)
    .set({ bachsCheckoutId: session.checkout_id, updatedAt: sql`now()` })
    .where(eq(organizationInvoices.id, invoice.id))

  await db.update(organizationSubscriptions)
    .set({
      interval: input.interval,
      collectionCurrency: input.collectionCurrency,
      collectionMethod: method,
      lastInvoiceReference: reference,
      updatedAt: sql`now()`
    })
    .where(eq(organizationSubscriptions.organizationId, input.organizationId))

  await recordAudit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: 'billing.checkout_opened',
    targetType: 'invoice',
    targetId: reference,
    metadata: { amountCents, seats, interval: input.interval, currency: input.collectionCurrency, method }
  })

  return { checkoutUrl: session.checkout_url, reference, collectionMethod: method }
}

/**
 * Runs from the webhook and from the post-checkout redirect, which race by
 * design. The status check happens inside the transaction so two concurrent
 * deliveries cannot both extend the period.
 */
export async function markInvoicePaid(input: {
  reference: string
  chargeId?: string | null
  settlementAmountCents?: number | null
}) {
  const db = useDatabase()

  return db.transaction(async (tx) => {
    const [invoice] = await tx.select()
      .from(organizationInvoices)
      .where(eq(organizationInvoices.reference, input.reference))
      .limit(1)
      .for('update')

    if (!invoice) return { applied: false, reason: 'unknown-reference' as const }
    if (invoice.status === 'paid') return { applied: false, reason: 'already-paid' as const }

    await tx.update(organizationInvoices).set({
      status: 'paid',
      paidAt: sql`now()`,
      bachsChargeId: input.chargeId ?? invoice.bachsChargeId,
      // Credit what reached the balance, never the gross charge.
      settlementAmountCents: input.settlementAmountCents ?? invoice.amountCents,
      updatedAt: sql`now()`
    }).where(eq(organizationInvoices.id, invoice.id))

    await tx.update(organizationSubscriptions).set({
      status: 'active',
      interval: invoice.interval,
      collectionCurrency: invoice.collectionCurrency,
      currentPeriodEnd: invoice.periodEnd,
      graceEndsAt: null,
      trialEndsAt: null,
      seatsAtLastInvoice: invoice.seats,
      lastInvoiceReference: invoice.reference,
      updatedAt: sql`now()`
    }).where(eq(organizationSubscriptions.organizationId, invoice.organizationId))

    return { applied: true, organizationId: invoice.organizationId, reason: 'paid' as const }
  })
}

export async function markInvoiceFailed(reference: string, reason: string) {
  await useDatabase().update(organizationInvoices)
    .set({ status: 'failed', lastError: reason, updatedAt: sql`now()` })
    .where(eq(organizationInvoices.reference, reference))
}

/**
 * Bachs owns the lifecycle once a subscription exists — it retries the card and
 * moves the status itself — so this mirrors its verdict rather than deriving
 * one. `past_due` keeps access while retries continue; `unpaid` ends it.
 */
export async function applySubscriptionState(subscription: BachsSubscription) {
  const organizationId = subscription.metadata?.organizationId
  if (!organizationId) return { applied: false, reason: 'no-organization' as const }

  const periodEndAt = subscription.current_period_end ?? subscription.next_billed_at
  const status = subscription.status as OrganizationPlanStatus

  const metadataSeats = Number.parseInt(
    subscription.product?.metadata?.schedra_seats
    ?? subscription.metadata?.seats
    ?? '',
    10
  )
  const billedSeats = Number.isInteger(metadataSeats) && metadataSeats > 0
    ? metadataSeats
    : subscription.quantity ?? null

  await useDatabase().update(organizationSubscriptions).set({
    status,
    collectionMethod: 'charge_automatically',
    bachsSubscriptionId: subscription.id,
    currentPeriodEnd: periodEndAt ? new Date(periodEndAt) : null,
    trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end) : null,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    seatsAtLastInvoice: billedSeats,
    // Bachs is doing the chasing, so our own grace clock does not apply.
    graceEndsAt: null,
    updatedAt: sql`now()`
  }).where(eq(organizationSubscriptions.organizationId, organizationId))

  // A subscription webhook is also a reconciliation signal. This covers the
  // race where a member joined while the initial checkout was still pending,
  // and repairs existing subscriptions after a deploy without making webhook
  // delivery wait on an external plan-change request.
  await enqueueSubscriptionSeatSync(organizationId)

  return { applied: true, organizationId, status, billedSeats }
}
