import { getConnectedAccount, type BachsSubscription } from '../../integrations/bachs'
import { applySubscriptionState, markInvoiceFailed, markInvoicePaid } from '../billing'
import { recordAudit } from '../organization'
import {
  applyRefundEvent,
  completePaidBooking,
  failPaidBooking,
  recordPaidBookingProviderObservation
} from '../paid-booking'
import { updateRecipientFromWebhook } from '../payment-recipient'

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
    fee?: string | { amount?: string | null } | null
    fees?: { amount?: string | null } | null
    payment_method?: string | { type?: string | null, name?: string | null } | null
    metadata?: Record<string, string>
    payment_status?: string | null
    currency?: string | null
    account?: string | null
    refund_id?: string | null
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

  const checkoutId = payload.data?.checkout_id
  if (checkoutId && PAID_EVENTS.has(type)) {
    const result = await completePaidBooking({
      checkoutId,
      chargeId: payload.data?.charge?.id ?? payload.data?.charge_id,
      amount: payload.data?.charge?.amount ?? payload.data?.amount,
      amountPaidCents: toCents(payload.data?.amount_paid ?? undefined),
      amountCollectedCents: toCents(payload.data?.amount_collected ?? payload.data?.settlement_amount),
      providerFeeCents: feeCents(payload.data),
      paymentMethod: paymentMethodLabel(payload.data?.payment_method),
      currency: payload.data?.charge?.currency ?? payload.data?.currency,
      paymentStatus: payload.data?.payment_status ?? payload.data?.charge?.status ?? payload.data?.status,
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

function feeCents(data: BachsEvent['data']) {
  const value = typeof data?.fee === 'string'
    ? data.fee
    : data?.fee?.amount ?? data?.fees?.amount ?? undefined
  return toCents(value ?? undefined)
}

function paymentMethodLabel(value: string | {
  type?: string | null
  name?: string | null
} | null | undefined) {
  if (!value) return null
  if (typeof value === 'string') return value
  return value.type ?? value.name ?? null
}
