import { bachsWebhookEvents } from '../../database/schema'
import { useDatabase } from '../../utils/database'
import { verifyWebhookSignature } from '../../utils/bachs'
import { markInvoiceFailed, markInvoicePaid } from '../../utils/billing'
import { recordAudit } from '../../utils/organization'

interface BachsEvent {
  id?: string
  type?: string
  data?: {
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

export default defineEventHandler(async (event) => {
  // The signature covers the bytes as sent. Parsing first and re-serialising
  // changes whitespace and key order, and verification then always fails.
  const raw = await readRawBody(event, 'utf8')
  if (!raw) throw createError({ statusCode: 400, statusMessage: 'Empty webhook body' })

  const verified = verifyWebhookSignature(
    raw,
    getHeader(event, 'x-bachs-timestamp'),
    getHeader(event, 'x-bachs-signature')
  )
  if (!verified) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid webhook signature' })
  }

  let payload: BachsEvent
  try {
    payload = JSON.parse(raw)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Malformed webhook body' })
  }

  const eventId = payload.id
  const type = payload.type ?? 'unknown'
  if (!eventId) throw createError({ statusCode: 400, statusMessage: 'Webhook is missing an event id' })

  // Claiming the id first makes a redelivery a no-op regardless of what the
  // handler below does.
  const claimed = await useDatabase()
    .insert(bachsWebhookEvents)
    .values({ id: eventId, type, payload: payload as unknown as Record<string, unknown> })
    .onConflictDoNothing({ target: bachsWebhookEvents.id })
    .returning({ id: bachsWebhookEvents.id })

  if (!claimed.length) return { received: true, duplicate: true }

  const reference = payload.data?.reference
  if (!reference) return { received: true, ignored: 'no-reference' }

  if (PAID_EVENTS.has(type)) {
    const result = await markInvoicePaid({
      reference,
      chargeId: payload.data?.charge_id ?? null,
      // Credit what reached the balance, not what the customer was charged.
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

  // Acknowledge everything else so Bachs stops retrying events we do not handle.
  return { received: true, ignored: type }
})

function toCents(amount: string | undefined) {
  if (!amount) return null
  const parsed = Number.parseFloat(amount)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null
}
