import { createHmac, timingSafeEqual } from 'node:crypto'
import { fetchWithTimeout } from './fetch'
import { useEnv } from './env'

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
  billingCurrency?: string
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
      ...(input.billingCurrency && input.billingCurrency !== input.currency
        ? { billing_currency: input.billingCurrency }
        : {}),
      reference: input.reference,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: input.metadata
    }
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
