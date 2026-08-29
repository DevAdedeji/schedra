import { getCheckoutSession, getConnectedAccount, type BachsSubscription } from '../../integrations/bachs'
import { applySubscriptionState, markInvoiceFailed, markInvoicePaid } from '../billing'
import { recordAudit } from '../organization'
import {
  applyRefundEvent,
  completePaidBookingFromCheckout,
  failPaidBooking,
  recordPaidBookingProviderObservation
} from '../paid-booking'
import { updateRecipientFromWebhook } from '../payment-recipient'
import { applyWithdrawalPayoutEvent } from '../payment-withdrawal'

export interface BachsEvent {
  id?: string
  type?: string
  organization_id?: string
  account?: string
  data?: {
    id?: string
    charge_id?: string | null
    checkout_id?: string | null
    reference?: string
    status?: string
    amount?: string
    amount_paid?: string | null
    amount_collected?: string | null
    amount_remaining?: string | null
    settlement_amount?: string
    settlement_currency?: string | null
    fee?: string | { amount?: string | null } | null
    fees?: { amount?: string | null } | null
    payment_method?: string | { type?: string | null, name?: string | null } | null
    metadata?: Record<string, string>
    payment_status?: string | null
    currency?: string | null
    account?: string | null
    refund_id?: string | null
    withdrawal_id?: string | null
    charge?: { id?: string | null, amount?: string | null, currency?: string | null, status?: string | null } | null
  }
}

const PAID_EVENTS = new Set(['collection.succeeded', 'checkout.completed', 'invoice.paid'])
const FAILED_EVENTS = new Set(['collection.failed', 'checkout.expired', 'invoice.payment_failed'])
const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted'
])
const PAYOUT_EVENTS = new Set(['payout.created', 'payout.paid', 'payout.failed'])

export async function processBachsWebhook(payload: BachsEvent) {
  const type = payload.type ?? 'unknown'
  if (type === 'account.updated' || type === 'capability.updated') {
    const accountId = payload.account ?? payload.data?.account
    if (!accountId) return { received: true, ignored: 'no-account' }
    const account = await getConnectedAccount(accountId)
    return { received: true, applied: await updateRecipientFromWebhook(account) }
  }

  if (type === 'refund.paid' || type === 'refund.failed') {
    const applied = await applyRefundEvent({
      reference: payload.data?.reference,
      status: type === 'refund.paid' ? 'paid' : 'failed',
      providerEventId: payload.id,
      refundId: payload.data?.refund_id
    })
    if (applied) return { received: true, applied: true }
  }

  if (PAYOUT_EVENTS.has(type)) {
    const accountId = payload.account ?? payload.organization_id ?? payload.data?.account
    const payoutId = payload.data?.withdrawal_id
    if (!accountId || !payoutId) return { received: true, ignored: 'incomplete-payout' }
    const applied = await applyWithdrawalPayoutEvent({
      accountId,
      payoutId,
      reference: payload.data?.reference,
      providerEventId: payload.id
    })
    return applied
      ? { received: true, applied: true }
      : { received: true, ignored: 'unknown-payout' }
  }

  const checkoutId = payload.data?.checkout_id
  if (checkoutId && PAID_EVENTS.has(type)) {
    // Bachs event payloads describe collection, settlement and checkout money
    // in different fields. Fetching the checkout gives us one authoritative
    // base price and payment status before applying the immutable-price check.
    const checkout = await getCheckoutSession(checkoutId)
    const result = await completePaidBookingFromCheckout(checkout, {
      amountCollectedCents: toCents(payload.data?.amount_collected ?? payload.data?.settlement_amount),
      amountCollectedCurrency: payload.data?.settlement_currency ?? payload.data?.currency,
      providerEventId: payload.id
    })
    if (result.matched) {
      if (!result.applied && 'reason' in result && result.reason === 'not-paid') {
        await recordPaidBookingProviderObservation({
          checkoutId,
          providerEventId: payload.id,
          providerStatus: payload.data?.payment_status ?? payload.data?.charge?.status ?? payload.data?.status,
          eventType: type,
          amountPaidCents: toCents(payload.data?.amount_paid ?? undefined),
          amountRemainingCents: toCents(payload.data?.amount_remaining ?? undefined)
        })
      }
      return {
        received: true,
        applied: result.applied,
        ...('reason' in result ? { reason: result.reason } : {})
      }
    }
  }
  if (checkoutId && FAILED_EVENTS.has(type) && await failPaidBooking(checkoutId, type, payload.id)) {
    return { received: true, applied: true }
  }
  if (checkoutId && await recordPaidBookingProviderObservation({
    checkoutId,
    providerEventId: payload.id,
    providerStatus: payload.data?.payment_status ?? payload.data?.charge?.status ?? payload.data?.status,
    eventType: type,
    amountPaidCents: toCents(payload.data?.amount_paid ?? undefined),
    amountRemainingCents: toCents(payload.data?.amount_remaining ?? undefined)
  })) {
    return { received: true, applied: true, reason: 'payment-observation-recorded' }
  }

  if (SUBSCRIPTION_EVENTS.has(type)) {
    const subscription = payload.data as unknown as BachsSubscription
    if (!subscription?.id) return { received: true, ignored: 'no-subscription' }
    const result = await applySubscriptionState(subscription)
    if (result.applied && result.organizationId) {
      await recordAudit({
        organizationId: result.organizationId,
        action: `billing.subscription_${subscription.status}`,
        targetType: 'subscription',
        targetId: subscription.id,
        metadata: { type, billedSeats: result.billedSeats ?? null }
      })
    }
    return { received: true, applied: result.applied, reason: result.reason }
  }

  const reference = payload.data?.reference
  if (!reference) return { received: true, ignored: 'no-reference' }

  if (PAID_EVENTS.has(type)) {
    const result = await markInvoicePaid({
      reference,
      chargeId: payload.data?.charge_id ?? null,
      settlementAmountCents: toCents(payload.data?.settlement_amount)
    })
    if (result.applied && result.organizationId) {
      await recordAudit({
        organizationId: result.organizationId,
        action: 'billing.invoice_paid',
        targetType: 'invoice',
        targetId: reference,
        metadata: { type, chargeId: payload.data?.charge_id ?? null }
      })
    }
    return { received: true, applied: result.applied, reason: result.reason }
  }

  if (FAILED_EVENTS.has(type)) {
    await markInvoiceFailed(reference, type)
    return { received: true, applied: true }
  }
  return { received: true, ignored: type }
}

function toCents(amount: string | undefined) {
  if (!amount) return null
  const parsed = Number.parseFloat(amount)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null
}
