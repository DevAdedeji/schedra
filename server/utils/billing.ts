import { eq, sql } from 'drizzle-orm'
import type { BillingInterval, CollectionCurrency } from '#shared/billing'
import { TEAM_PLAN, billableSeats, invoiceTotalCents, toDecimalString } from '#shared/billing'
import { organizationInvoices, organizationSubscriptions } from '../database/schema'
import { useDatabase } from './database'
import { createCheckoutSession } from './bachs'
import { organizationEntitlement } from './entitlement'
import { recordAudit } from './organization'
import { useEnv } from './env'

// Bachs rejects NGN checkouts below ₦1,000. The smallest possible team invoice
// is the two-seat minimum, which is far above that, so it can never bite here.
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
  const db = useDatabase()
  const entitlement = await organizationEntitlement(input.organizationId)

  const seats = billableSeats(entitlement.seatsUsed)
  const amountCents = invoiceTotalCents(entitlement.seatsUsed, input.interval)
  const start = new Date()
  const end = periodEnd(start, input.interval)
  const reference = invoiceReference(input.organizationId, start)

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

  const session = await createCheckoutSession({
    // Prices are quoted in USD; billing_currency lets a Nigerian team settle in
    // NGN over the much cheaper bank-transfer rail.
    amount: toDecimalString(amountCents),
    currency: TEAM_PLAN.currency,
    billingCurrency: input.collectionCurrency,
    reference,
    customer: input.customer,
    successUrl: `${env.schedraUrl}/t/${input.organizationSlug}/billing?paid=1`,
    cancelUrl: `${env.schedraUrl}/t/${input.organizationSlug}/billing`,
    metadata: {
      organizationId: input.organizationId,
      interval: input.interval,
      seats: String(seats)
    }
  }).catch(async (failure) => {
    await db.update(organizationInvoices)
      .set({ status: 'failed', lastError: String(failure?.statusMessage ?? failure), updatedAt: sql`now()` })
      .where(eq(organizationInvoices.id, invoice.id))
    throw failure
  })

  await db.update(organizationInvoices)
    .set({ bachsCheckoutId: session.checkout_id, updatedAt: sql`now()` })
    .where(eq(organizationInvoices.id, invoice.id))

  await db.update(organizationSubscriptions)
    .set({
      interval: input.interval,
      collectionCurrency: input.collectionCurrency,
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
    metadata: { amountCents, seats, interval: input.interval, currency: input.collectionCurrency }
  })

  return { checkoutUrl: session.checkout_url, reference }
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
      // Credit what actually landed, never the gross charge.
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
