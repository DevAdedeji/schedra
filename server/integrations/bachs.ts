import { createHmac, timingSafeEqual } from 'node:crypto'
import type { BillingInterval } from '#shared/billing'
import {
  PERSONAL_PRO_PLAN,
  TEAM_PLAN,
  personalProPriceCents,
  seatPriceCents,
  toDecimalString
} from '#shared/billing'
import { fetchWithTimeout } from './fetch'
import { logEvent } from '../observability/logger'
import { useEnv } from '../config/env'

const SANDBOX_API = 'https://sandbox-api.bachs.io/v1'
const LIVE_API = 'https://api.bachs.io/v1'

/** Replay window for webhook timestamps, in seconds. */
const WEBHOOK_TOLERANCE_SECONDS = 300
const SAFE_REQUEST_ATTEMPTS = 3
const SAFE_REQUEST_RETRY_DELAYS_MS = [150, 400]
const MAX_INLINE_RETRY_AFTER_MS = 2_000

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
  headers?: Record<string, string>
  idempotencyKey?: string
  retryTransient?: boolean
}

export async function bachsFetch<T>(path: string, options: BachsRequest = {}): Promise<T> {
  const { method = 'GET', body, query, idempotencyKey } = options

  const url = new URL(`${apiUrl()}${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${secretKey()}`,
    'Content-Type': 'application/json',
    ...options.headers
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

  // Only callers that need a short, in-request recovery window opt in. Durable
  // workers own their own longer backoff and must receive the first failure.
  // Writes still require an idempotency key before they can ever be repeated.
  const safeToRetry = method === 'GET' || Boolean(idempotencyKey)
  const attempts = options.retryTransient && safeToRetry ? SAFE_REQUEST_ATTEMPTS : 1
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response: Response
    try {
      response = await fetchWithTimeout(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      }, 15_000)
    } catch (error) {
      if (attempt < attempts) {
        logRetry(method, path, attempt, null, error)
        await waitForRetry(attempt)
        continue
      }
      logEvent('error', 'bachs_request_failed', {
        method,
        path,
        status: null,
        attempt,
        error
      })
      throw createError({
        statusCode: 503,
        statusMessage: 'Bachs is temporarily unavailable. Please try again shortly.'
      })
    }

    const text = await response.text()
    const payload = text ? safeJson(text) : null
    if (response.ok) return payload as T

    const retryAfterMs = retryAfterMilliseconds(response)
    if (
      attempt < attempts
      && isTransientStatus(response.status)
      && (retryAfterMs === undefined || retryAfterMs <= MAX_INLINE_RETRY_AFTER_MS)
    ) {
      logRetry(method, path, attempt, response.status)
      await waitForRetry(attempt, retryAfterMs)
      continue
    }

    // Bachs returns { detail, error_code, doc_url } — reading `message` first
    // turns every failure into a useless "request failed".
    const detail = payload?.detail ?? payload?.message ?? `Bachs request failed (${response.status})`
    logEvent('error', 'bachs_request_failed', {
      method,
      path,
      status: response.status,
      attempt,
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
      data: {
        errorCode: payload?.error_code,
        details: payload?.details ?? null
      }
    })
  }

  // The loop always returns or throws. This is an explicit guard for future
  // changes to the retry policy and keeps the function total for TypeScript.
  throw createError({ statusCode: 503, statusMessage: 'Bachs is temporarily unavailable.' })
}

function isTransientStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function retryAfterMilliseconds(response: Response) {
  const value = response.headers.get('retry-after')?.trim()
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}

function logRetry(method: string, path: string, attempt: number, status: number | null, error?: unknown) {
  logEvent('warn', 'bachs_request_retrying', {
    method,
    path,
    status,
    attempt,
    nextAttempt: attempt + 1,
    error
  })
}

function waitForRetry(attempt: number, retryAfterMs?: number) {
  const delayMs = retryAfterMs ?? SAFE_REQUEST_RETRY_DELAYS_MS[attempt - 1] ?? 400
  return new Promise(resolve => setTimeout(resolve, delayMs))
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
  checkout_url?: string
  status: 'open' | 'completed' | 'expired' | 'cancelled'
  payment_status?: 'requires_payment_method' | 'requires_confirmation' | 'requires_action' | 'processing' | 'succeeded' | 'failed' | 'canceled' | null
  amount: string
  currency: string
  reference: string | null
  charge?: {
    payment_id: string
    status: 'created' | 'processing' | 'succeeded' | 'accepted' | 'failed' | 'expired' | 'cancelled' | 'refunded' | 'partially_refunded' | 'underpaid' | 'overpaid'
    amount: string
    amount_paid?: string | null
    currency: string
    fee_usd?: string | null
  } | null
  payment_method?: string | null
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
  /** Account-wide state shown by Bachs (for example, `incomplete`). */
  status?: string | null
  setup_status?: string | null
  onboarding_status?: string | null
  is_active?: boolean
  details_submitted?: boolean
  payouts_enabled?: boolean
  transfers_enabled?: boolean
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
    persons?: Array<{ id?: string, first_name?: string | null, last_name?: string | null }>
    [key: string]: unknown
  }
}

export function createConnectedAccount(input: {
  email: string
  name: string
  firstName?: string
  lastName?: string
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
      ...(input.firstName ? { first_name: input.firstName } : {}),
      ...(input.lastName ? { last_name: input.lastName } : {}),
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

export function updateConnectedAccountRepresentative(input: {
  accountId: string
  firstName: string
  lastName?: string
}) {
  return bachsFetch<BachsConnectedAccount>(`/accounts/${encodeURIComponent(input.accountId)}`, {
    method: 'POST',
    body: {
      fields: {
        persons: [{
          first_name: input.firstName,
          ...(input.lastName ? { last_name: input.lastName } : {}),
          relationship: { representative: true }
        }]
      }
    }
  })
}

export interface BachsBalanceBucket {
  currency: string
  available_balance: string
  pending_balance: string
}

export interface BachsAccountBalance {
  account_id: string
  balances: BachsBalanceBucket[]
  total_balance_usd: string
}

/**
 * Financial reads must run in the connected account's context. Without this
 * header Bachs returns Schedra's platform balance, which must never be shown to
 * an individual host or team.
 */
export function getConnectedAccountBalance(accountId: string) {
  return bachsFetch<BachsAccountBalance>('/balances', {
    headers: { 'X-Account-Id': accountId }
  })
}

export interface BachsPayout {
  id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  amount: string
  currency: string
  source_currency?: string | null
  fee?: string | null
  total_debited?: string | null
  destination?: string | null
  reference?: string | null
  failure_reason?: string | null
  created_at?: string | null
  completed_at?: string | null
}

export interface BachsPayoutQuote {
  quote_id: string
  from_currency: string
  to_currency: string
  from_amount: string
  to_amount: string
  exchange_rate: string
  expires_at: string
}

export interface BachsPayoutEstimate {
  from_currency: string
  to_currency: string
  amount: string
  payout_method: 'BANK_TRANSFER' | 'MOBILE_MONEY' | 'CRYPTO'
  withdrawal_fee: string
  gross_from_amount: string
  exchange_rate?: string | null
  to_amount: string
}

export interface BachsPayoutDestination {
  id: string
  name: string
  type: 'bank_account' | 'mobile_money' | 'crypto_wallet'
  currency: string
  status: 'pending_review' | 'approved' | 'rejected'
  status_reason?: string | null
  is_usable: boolean
  is_default: boolean
}

interface BachsPayoutDestinationPage {
  destinations: BachsPayoutDestination[]
  total: number
  limit: number
  offset: number
}

/**
 * A capability only says that withdrawals are permitted. The destination is a
 * separate reviewed resource, so payout readiness must verify both.
 */
export async function listConnectedAccountPayoutDestinations(accountId: string) {
  const destinations: BachsPayoutDestination[] = []
  const limit = 100
  let offset = 0
  let hasMore = true

  while (hasMore) {
    const page = await bachsFetch<BachsPayoutDestinationPage>('/payouts/destinations', {
      headers: { 'X-Account-Id': accountId },
      query: { limit, offset }
    })
    destinations.push(...(page.destinations ?? []))
    offset += limit
    hasMore = destinations.length < (page.total ?? 0) && Boolean(page.destinations?.length)
  }

  return destinations
}

interface BachsPayoutPage {
  total: number
  items: BachsPayout[]
}

export async function listConnectedAccountPayouts(accountId: string) {
  const items: BachsPayout[] = []
  const limit = 100
  let offset = 0
  let hasMore = true

  while (hasMore) {
    const page = await bachsFetch<BachsPayoutPage>('/payouts', {
      headers: { 'X-Account-Id': accountId },
      query: { limit, offset }
    })
    items.push(...(page.items ?? []))
    offset += limit
    hasMore = items.length < (page.total ?? 0) && Boolean(page.items?.length)
  }

  return items
}

export function getConnectedAccountPayout(accountId: string, payoutId: string) {
  return bachsFetch<BachsPayout>(`/payouts/${encodeURIComponent(payoutId)}`, {
    headers: { 'X-Account-Id': accountId },
    retryTransient: true
  })
}

export function createConnectedAccountPayoutQuote(input: {
  accountId: string
  fromCurrency: string
  toCurrency: string
  amount: string
  payoutMethod: BachsPayoutEstimate['payout_method']
}) {
  return bachsFetch<BachsPayoutQuote>('/payouts/quotes', {
    method: 'POST',
    headers: { 'X-Account-Id': input.accountId },
    body: {
      from_currency: input.fromCurrency,
      to_currency: input.toCurrency,
      amount: input.amount,
      payout_method: input.payoutMethod
    }
  })
}

export function estimateConnectedAccountPayout(input: {
  accountId: string
  fromCurrency: string
  toCurrency: string
  amount: string
  payoutMethod: BachsPayoutEstimate['payout_method']
}) {
  return bachsFetch<BachsPayoutEstimate>('/payouts/estimate', {
    method: 'POST',
    headers: { 'X-Account-Id': input.accountId },
    body: {
      from_currency: input.fromCurrency,
      to_currency: input.toCurrency,
      amount: input.amount,
      payout_method: input.payoutMethod
    }
  })
}

/**
 * A withdrawal is irreversible once Bachs accepts it. The stable Schedra
 * reference is therefore both the provider reference and Idempotency-Key, and
 * transient retries are only enabled because that key makes them safe.
 */
export function createConnectedAccountPayout(input: {
  accountId: string
  destinationId: string
  reference: string
  amount?: string
  quoteId?: string
  metadata?: Record<string, string>
}) {
  if (Boolean(input.amount) === Boolean(input.quoteId)) {
    throw new Error('A payout requires exactly one of amount or quoteId.')
  }
  return bachsFetch<BachsPayout>('/payouts', {
    method: 'POST',
    headers: { 'X-Account-Id': input.accountId },
    idempotencyKey: input.reference,
    retryTransient: true,
    body: {
      destination: input.destinationId,
      reference: input.reference,
      ...(input.amount ? { amount: input.amount } : { quote_id: input.quoteId }),
      ...(input.metadata ? { metadata: input.metadata } : {})
    }
  })
}

export interface BachsAccountLink {
  id: string
  account: string
  url: string
  expires_at: string
}

export function createConnectedAccountLink(input: {
  accountId: string
  type?: 'onboarding' | 'update'
  refreshUrl: string
  returnUrl: string
}) {
  return bachsFetch<BachsAccountLink>(
    `/accounts/${encodeURIComponent(input.accountId)}/account-links`,
    {
      method: 'POST',
      body: {
        type: input.type ?? 'onboarding',
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
  return bachsFetch<BachsCheckoutSession>(
    `/checkout-sessions/${encodeURIComponent(checkoutId)}`,
    { retryTransient: true }
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

export async function ensurePersonalProProduct(interval: BillingInterval): Promise<string> {
  const key = `personal_pro_${interval}`
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
      name: `Schedra Personal Pro (${interval})`,
      description: 'Advanced solo scheduling, custom branding and lower paid-booking fees.',
      price: {
        currency: PERSONAL_PRO_PLAN.currency,
        price_type: 'fixed',
        amount: toDecimalString(personalProPriceCents(interval))
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
