import type { BachsSubscription } from '../../integrations/bachs'
import { applySubscriptionState, markInvoiceFailed, markInvoicePaid } from '../billing'
import { recordAudit } from '../organization'

export interface BachsEvent {
  id?: string
  type?: string
  data?: {
    id?: string
    charge_id?: string | null
    checkout_id?: string | null
    reference?: string
    status?: string
    amount?: string
    settlement_amount?: string
    metadata?: Record<string, string>
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
