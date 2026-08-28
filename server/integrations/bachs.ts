import { createHmac, timingSafeEqual } from 'node:crypto'
import type { BillingInterval } from '#shared/billing'
import { TEAM_PLAN, seatPriceCents, toDecimalString } from '#shared/billing'
import { fetchWithTimeout } from './fetch'
import { logEvent } from '../observability/logger'
import { useEnv } from '../config/env'

const SANDBOX_API = 'https://sandbox-api.bachs.io/v1'
const LIVE_API = 'https://api.bachs.io/v1'

/** Replay window for webhook timestamps, in seconds. */
const WEBHOOK_TOLERANCE_SECONDS = 300

export const NGN_ONE_TIME_PAYMENT_METHOD_OPTIONS: Record<string, { currencies: string[] }> = {
  bank_transfer: { currencies: ['NGN'] },
  card: { currencies: ['NGN'] }
}

export function bachsConfigured() {
  return Boolean(useEnv().bachsSecretKey)
}

function secretKey() {
  const key = useEnv().bachsSecretKey
  if (!key) {
    throw createError({ statusCode: 503, statusMessage: 'Billing is not configured yet.' })
  }
  return key
}

// Going live is a key swap and nothing else — deriving the host from the key
// prefix means there is no second setting to forget.
function apiUrl() {
  return secretKey().startsWith('sk_sandbox_') ? SANDBOX_API : LIVE_API
}

interface BachsRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: Record<string, unknown>
  query?: Record<string, string | number | undefined>
  idempotencyKey?: string
}

export async function bachsFetch<T>(path: string, options: BachsRequest = {}): Promise<T> {
  const { method = 'GET', body, query, idempotencyKey } = options

  const url = new URL(`${apiUrl()}${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${secretKey()}`,
    'Content-Type': 'application/json'
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

  const response = await fetchWithTimeout(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  }, 15_000)

  const text = await response.text()
  const payload = text ? safeJson(text) : null

  if (!response.ok) {
    // Bachs returns { detail, error_code, doc_url } — reading `message` first
    // turns every failure into a useless "request failed".
    const detail = payload?.detail ?? payload?.message ?? `Bachs request failed (${response.status})`
    logEvent('error', 'bachs_request_failed', {
      method,
      path,
      status: response.status,
      errorCode: payload?.error_code ?? null,
      detail
    })
    const errorCode = String(payload?.error_code ?? '')
    const unavailablePaymentMethod = [
      'CHECKOUT_RESTRICTION_LEAVES_NO_PAYMENT_METHOD',
      'CHECKOUT_HAS_NO_PAYMENT_METHOD'
    ].includes(errorCode)
    throw createError({
      statusCode: unavailablePaymentMethod ? 503 : response.status === 422 ? 502 : response.status,
      statusMessage: unavailablePaymentMethod
        ? 'Checkout is temporarily unavailable because Bachs found no compatible payment method for this currency and plan. Check the live payment-method configuration, then try again.'
        : String(detail),
      data: { errorCode: payload?.error_code }
    })
  }

  return payload as T
}

function safeJson(text: string) {
  try {
    return JSON.parse(text) as Record<string, string> & Record<string, unknown>
  } catch {
    return null
  }
}

export interface BachsCheckoutSession {
  checkout_id: string
  checkout_url: string
  status: string
  amount: string
  currency: string
  reference: string
  expires_at?: string | null
}

export function createCheckoutSession(input: {
  amount: string
  currency: string
  paymentMethodOptions?: Record<string, { currencies: string[] }>
  reference: string
  customer: { email: string, name: string }
  successUrl: string
  cancelUrl: string
  metadata: Record<string, string>
  platformFee?: string
  destinationAccountId?: string
  expiresInMinutes?: number
}) {
  return bachsFetch<BachsCheckoutSession>('/checkout-sessions', {
    method: 'POST',
    idempotencyKey: input.reference,
    body: {
      pricing: { currency: input.currency, amount: input.amount, price_type: 'fixed' },
      // A new customer is rejected without a name, not just an email.
      customer: input.customer,
      ...(input.paymentMethodOptions ? { payment_method_options: input.paymentMethodOptions } : {}),
      reference: input.reference,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: input.metadata,
      ...(input.platformFee && input.destinationAccountId
        ? {
            platform_fee: input.platformFee,
            transfer_data: { destination: input.destinationAccountId }
          }
        : {}),
      ...(input.expiresInMinutes ? { expires_in_minutes: input.expiresInMinutes } : {})
    }
  })
}

export interface BachsConnectedAccount {
  id: string
  name?: string | null
  contact_email?: string | null
  setup_status?: string | null
  is_active?: boolean
  capabilities?: Record<string, {
    status?: string
    requested?: boolean
    status_details?: Array<{ code?: string, resolution?: string, message?: string }> | null
  }>
  requirements?: {
    setup_status?: string
    currently_due?: string[]
    eventually_due?: string[]
    past_due?: string[]
    pending_verification?: string[]
    errors?: Array<{ field?: string, code?: string, reason?: string }>
    [key: string]: unknown
  }
}

export function createConnectedAccount(input: {
  email: string
  name: string
  reference: string
  entityType: 'individual' | 'company'
}) {
  return bachsFetch<BachsConnectedAccount>('/accounts', {
    method: 'POST',
    // Email addresses are not unique across personal and team recipients.
    // The immutable Schedra owner reference makes retries safe without ever
    // merging two payout accounts that happen to share an inbox.
    idempotencyKey: `schedra-recipient-${input.reference}`,
    body: {
      contact_email: input.email,
      display_name: input.name,
      entity_type: input.entityType,
      configuration: {
        recipient: {
          capabilities: {
            transfers: { requested: true },
            payouts: { requested: true }
          }
        }
      },
      responsibilities: { fees: { collector: 'bachs' } }
    }
  })
}

export function getConnectedAccount(accountId: string) {
  return bachsFetch<BachsConnectedAccount>(`/accounts/${encodeURIComponent(accountId)}`)
}

export interface BachsAccountLink {
  id: string
  account: string
  url: string
  expires_at: string
}

export function createConnectedAccountLink(input: {
  accountId: string
  refreshUrl: string
  returnUrl: string
}) {
  return bachsFetch<BachsAccountLink>(
    `/accounts/${encodeURIComponent(input.accountId)}/account-links`,
    {
      method: 'POST',
      body: {
        type: 'onboarding',
        refresh_url: input.refreshUrl,
        return_url: input.returnUrl
      }
    }
  )
}

export interface BachsRefund {
  refund_id: string
  charge_id: string
  reference: string
  status: string
  requested_amount: string
}

export function createRefund(input: { chargeId: string, reference: string, reason: string }) {
  return bachsFetch<BachsRefund>('/refunds', {
    method: 'POST',
    idempotencyKey: input.reference,
    body: {
      charge_id: input.chargeId,
      reference: input.reference,
      reason: input.reason,
      fee_bearer: 'ORG'
    }
  })
}

export interface BachsQuote {
  quote_id: string
  from_currency: string
  to_currency: string
  from_amount: string
  to_amount: string
  exchange_rate: string
  expires_at: string
}

/**
 * Bachs will not accept `billing_currency` for a price it does not hold in that
 * currency — a USD-priced checkout simply cannot be paid in NGN. So an NGN
 * invoice has to be priced in NGN, converted at the live rate.
 */
export function quoteConversion(from: string, to: string, amount: string) {
  return bachsFetch<BachsQuote>('/conversions/quotes', {
    method: 'POST',
    body: { from_currency: from, to_currency: to, amount }
  })
}

export function getCheckoutSession(checkoutId: string) {
  return bachsFetch<BachsCheckoutSession & { reference: string }>(
    `/checkout-sessions/${encodeURIComponent(checkoutId)}`
  )
}

/**
 * The signature covers `{timestamp}.{rawBody}` — re-serialising parsed JSON
 * changes whitespace and key order, so the raw body has to be verified as read.
 */
export function verifyWebhookSignature(
  rawBody: string,
  timestampHeader?: string,
  signatureHeader?: string
) {
  const secret = useEnv().bachsWebhookSecret
  if (!secret || !timestampHeader || !signatureHeader) return false

  const timestamp = Number.parseInt(timestampHeader, 10)
  if (!Number.isFinite(timestamp)) return false
  if (Math.abs(Date.now() / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex')

  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signatureHeader, 'utf8')
  // timingSafeEqual throws on a length mismatch, so compare lengths first.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export interface BachsProduct {
  id: string
  name: string
  metadata?: Record<string, string> | null
}

export interface BachsSubscription {
  id: string
  status: 'trialing' | 'active' | 'past_due' | 'unpaid' | 'canceled' | 'paused'
  collection_method?: string
  payment_method_id?: string | null
  quantity?: number
  current_period_end?: string | null
  next_billed_at?: string | null
  trial_end?: string | null
  cancel_at_period_end?: boolean
  metadata?: Record<string, string> | null
  product?: BachsProduct | null
}

const planKey = (interval: BillingInterval, seats: number) => `team_${interval}_seats_${seats}`

interface BachsProductPage {
  items?: BachsProduct[]
  pagination?: { has_more?: boolean, next_cursor?: string | null }
}

async function findProductByPlan(key: string) {
  let cursor: string | undefined
  do {
    const page = await bachsFetch<BachsProductPage>('/products', {
      query: { limit: 100, cursor }
    })
    const match = (page.items ?? []).find(item => item.metadata?.schedra_plan === key)
    if (match) return match
    cursor = page.pagination?.has_more ? page.pagination.next_cursor ?? undefined : undefined
  } while (cursor)
  return null
}

/**
 * Bachs does not expose subscription quantity updates yet. A fixed-price
 * product for each supported seat count lets us use its supported plan-change
 * endpoint and immediate proration without losing per-seat billing semantics.
 */
export async function ensureTeamProduct(interval: BillingInterval, seats: number): Promise<string> {
  const billable = Math.max(TEAM_PLAN.minimumSeats, Math.floor(seats))
  if (billable > TEAM_PLAN.maxSeats) throw new Error(`Cannot bill more than ${TEAM_PLAN.maxSeats} seats.`)

  const key = planKey(interval, billable)
  const cached = productCache.get(key)
  if (cached) return cached

  const match = await findProductByPlan(key)
  if (match) {
    productCache.set(key, match.id)
    return match.id
  }

  const created = await bachsFetch<BachsProduct>('/products', {
    method: 'POST',
    idempotencyKey: `schedra-${key}`,
    body: {
      name: `Schedra Team — ${billable} ${billable === 1 ? 'seat' : 'seats'} (${interval})`,
      description: `Team scheduling on Schedra for ${billable} occupied ${billable === 1 ? 'seat' : 'seats'}.`,
      price: {
        currency: TEAM_PLAN.currency,
        price_type: 'fixed',
        amount: toDecimalString(seatPriceCents(interval) * billable)
      },
      billing_cycle: { interval: interval === 'yearly' ? 'year' : 'month', frequency: 1 },
      metadata: { schedra_plan: key, schedra_seats: String(billable) }
    }
  })

  productCache.set(key, created.id)
  return created.id
}

const productCache = new Map<string, string>()

export function getSubscription(subscriptionId: string) {
  return bachsFetch<BachsSubscription>(`/subscriptions/${encodeURIComponent(subscriptionId)}`)
}

export function updateSubscriptionPlan(
  subscriptionId: string,
  productId: string,
  prorationBehavior: 'invoice_now' | 'next_cycle' | 'none' = 'invoice_now'
) {
  return bachsFetch<BachsSubscription>(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'PATCH',
    body: { product_id: productId, proration_behavior: prorationBehavior }
  })
}

export function updateSubscriptionMetadata(subscriptionId: string, metadata: Record<string, string>) {
  return bachsFetch<BachsSubscription>(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'PATCH',
    body: { metadata }
  })
}

export function cancelSubscription(subscriptionId: string, atPeriodEnd = true) {
  return bachsFetch<BachsSubscription>(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'DELETE',
    body: { cancel_at_period_end: atPeriodEnd }
  })
}

export interface SubscriptionCheckoutInput {
  productId: string
  quantity: number
  reference: string
  customer: { email: string, name: string }
  successUrl: string
  cancelUrl: string
  metadata: Record<string, string>
}

/**
 * A cart of a recurring product is what makes Bachs open the session in
 * `subscription` mode — there is no create-subscription endpoint.
 */
export function createSubscriptionCheckout(input: SubscriptionCheckoutInput) {
  return bachsFetch<BachsCheckoutSession & { mode?: string }>('/checkout-sessions', {
    method: 'POST',
    idempotencyKey: input.reference,
    body: {
      product_cart: [{ product_id: input.productId, quantity: input.quantity }],
      billing_currency: TEAM_PLAN.currency,
      customer: input.customer,
      reference: input.reference,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: input.metadata
    }
  })
}
