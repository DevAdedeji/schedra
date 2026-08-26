import { createHmac, timingSafeEqual } from 'node:crypto'
import type { BillingInterval } from '#shared/billing'
import { TEAM_PLAN, seatPriceCents, toDecimalString } from '#shared/billing'
import { fetchWithTimeout } from './fetch'
import { useEnv } from '../config/env'

const SANDBOX_API = 'https://sandbox-api.bachs.io/v1'
const LIVE_API = 'https://api.bachs.io/v1'

/** Replay window for webhook timestamps, in seconds. */
const WEBHOOK_TOLERANCE_SECONDS = 300

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
    console.error(`Bachs ${method} ${path} [${payload?.error_code ?? '?'}]:`, detail)
    throw createError({
      statusCode: response.status === 422 ? 502 : response.status,
      statusMessage: String(detail),
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
      metadata: input.metadata
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
}

const planKey = (interval: BillingInterval) => `team_${interval}`

/**
 * One catalog product per billing interval, found by our own metadata key so a
 * redeploy never creates duplicates. Bachs has no upsert, so this is
 * list-then-create; the catalog is two rows, which makes that cheap.
 */
export async function ensureTeamProduct(interval: BillingInterval): Promise<string> {
  const key = planKey(interval)
  const cached = productCache.get(key)
  if (cached) return cached

  const existing = await bachsFetch<{ items?: BachsProduct[] }>('/products', { query: { limit: 100 } })
  const match = (existing.items ?? []).find(item => item.metadata?.schedra_plan === key)
  if (match) {
    productCache.set(key, match.id)
    return match.id
  }

  const created = await bachsFetch<BachsProduct>('/products', {
    method: 'POST',
    body: {
      name: interval === 'yearly' ? 'Schedra Team (yearly)' : 'Schedra Team (monthly)',
      description: 'Team scheduling on Schedra, billed per member who has joined.',
      price: {
        currency: TEAM_PLAN.currency,
        price_type: 'fixed',
        amount: toDecimalString(seatPriceCents(interval))
      },
      billing_cycle: { interval: interval === 'yearly' ? 'year' : 'month', frequency: 1 },
      metadata: { schedra_plan: key }
    }
  })

  productCache.set(key, created.id)
  return created.id
}

const productCache = new Map<string, string>()

export function getSubscription(subscriptionId: string) {
  return bachsFetch<BachsSubscription>(`/subscriptions/${encodeURIComponent(subscriptionId)}`)
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
      customer: input.customer,
      reference: input.reference,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      // Only a saved card can be charged automatically, so the subscription
      // path deliberately does not offer bank transfer.
      payment_method_options: { card: { currencies: [TEAM_PLAN.currency] } },
      metadata: input.metadata
    }
  })
}
