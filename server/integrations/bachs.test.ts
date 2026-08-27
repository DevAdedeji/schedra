import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  billingCheckoutReason,
  toDecimalString,
  fromDecimalString,
  billableSeats,
  invoiceTotalCents
} from '#shared/billing'

const SECRET = 'whsec-test-secret'

function sign(body: string, timestamp: number, secret = SECRET) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex')
}

describe('bachs webhook signatures', () => {
  let verify: typeof import('./bachs').verifyWebhookSignature

  beforeEach(async () => {
    process.env.DATABASE_URL ||= 'postgres://localhost:5432/schedra_test'
    process.env.SCHEDRA_URL ||= 'http://localhost:3002'
    process.env.AUTH_SECRET ||= 'x'.repeat(32)
    process.env.BACHS_SECRET_KEY = 'sk_sandbox_test'
    process.env.BACHS_WEBHOOK_SECRET = SECRET

    vi.stubGlobal('createError', (input: { statusCode: number, statusMessage: string, data?: unknown }) => (
      Object.assign(new Error(input.statusMessage), input)
    ))

    const { resetEnv } = await import('../config/env')
    resetEnv()
    verify = (await import('./bachs')).verifyWebhookSignature
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    delete process.env.BACHS_SECRET_KEY
    delete process.env.BACHS_WEBHOOK_SECRET
    const { resetEnv } = await import('../config/env')
    resetEnv()
  })

  it('accepts a signature over the exact raw body', () => {
    const body = '{"id":"evt_1","type":"collection.succeeded"}'
    const timestamp = Math.floor(Date.now() / 1000)

    expect(verify(body, String(timestamp), sign(body, timestamp))).toBe(true)
  })

  it('rejects a body that was re-serialised after parsing', () => {
    const body = '{"id":"evt_1","type":"collection.succeeded"}'
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = sign(body, timestamp)

    // Same data, different bytes — this is the mistake the guide warns about.
    const reserialised = JSON.stringify(JSON.parse(body), null, 2)
    expect(verify(reserialised, String(timestamp), signature)).toBe(false)
  })

  it('rejects a replayed delivery outside the tolerance window', () => {
    const body = '{"id":"evt_1"}'
    const stale = Math.floor(Date.now() / 1000) - 600

    expect(verify(body, String(stale), sign(body, stale))).toBe(false)
  })

  it('rejects a signature made with the wrong secret', () => {
    const body = '{"id":"evt_1"}'
    const timestamp = Math.floor(Date.now() / 1000)

    expect(verify(body, String(timestamp), sign(body, timestamp, 'not-the-secret'))).toBe(false)
  })

  it('rejects missing headers and malformed timestamps without throwing', () => {
    const body = '{"id":"evt_1"}'
    const timestamp = Math.floor(Date.now() / 1000)

    expect(verify(body, undefined, sign(body, timestamp))).toBe(false)
    expect(verify(body, String(timestamp), undefined)).toBe(false)
    expect(verify(body, 'not-a-number', sign(body, timestamp))).toBe(false)
    // A short signature would make timingSafeEqual throw if lengths were not
    // compared first.
    expect(verify(body, String(timestamp), 'abc')).toBe(false)
  })
})

describe('money at the bachs boundary', () => {
  it('renders cents as a fixed two-decimal string', () => {
    expect(toDecimalString(1600)).toBe('16.00')
    expect(toDecimalString(8000)).toBe('80.00')
    expect(toDecimalString(1)).toBe('0.01')
  })

  it('round-trips without float drift', () => {
    for (const cents of [1600, 8000, 12345, 99999]) {
      expect(fromDecimalString(toDecimalString(cents))).toBe(cents)
    }
  })

  it('reads a settlement amount that differs from the charge', () => {
    expect(fromDecimalString('74250.00')).toBe(7425000)
    expect(fromDecimalString(null)).toBe(0)
    expect(fromDecimalString(undefined)).toBe(0)
    expect(fromDecimalString('not-a-number')).toBe(0)
  })

  it('never bills below the owner seat', () => {
    expect(billableSeats(0)).toBe(1)
    expect(billableSeats(1)).toBe(1)
    expect(billableSeats(5)).toBe(5)
    expect(invoiceTotalCents(1, 'monthly')).toBe(800)
    expect(invoiceTotalCents(3, 'yearly')).toBe(24000)
  })

  it('does not offer a second checkout for provider-managed subscriptions', () => {
    expect(billingCheckoutReason('active', 'charge_automatically', false)).toBeNull()
    expect(billingCheckoutReason('active', 'charge_automatically', true)).toBeNull()
    expect(billingCheckoutReason('past_due', 'charge_automatically', false)).toBeNull()
    expect(billingCheckoutReason('unpaid', 'charge_automatically', false)).toBeNull()
  })

  it('offers checkout only when the customer genuinely needs to pay', () => {
    expect(billingCheckoutReason('trialing', 'invoice', false)).toBe('activate')
    expect(billingCheckoutReason('canceled', 'charge_automatically', false)).toBe('restart')
    expect(billingCheckoutReason('active', 'invoice', false)).toBeNull()
    expect(billingCheckoutReason('active', 'invoice', true)).toBe('manual_seat_change')
    expect(billingCheckoutReason('past_due', 'invoice', false)).toBe('manual_renewal')
  })
})

describe('bachs checkout payment methods', () => {
  beforeEach(async () => {
    process.env.DATABASE_URL ||= 'postgres://localhost:5432/schedra_test'
    process.env.SCHEDRA_URL ||= 'https://staging.schedra.xyz'
    process.env.AUTH_SECRET ||= 'x'.repeat(32)
    process.env.BACHS_SECRET_KEY = 'sk_sandbox_test'
    process.env.BACHS_WEBHOOK_SECRET = SECRET

    vi.stubGlobal('createError', (input: { statusCode: number, statusMessage: string, data?: unknown }) => (
      Object.assign(new Error(input.statusMessage), input)
    ))

    const { resetEnv } = await import('../config/env')
    resetEnv()
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    delete process.env.BACHS_SECRET_KEY
    delete process.env.BACHS_WEBHOOK_SECRET
    const { resetEnv } = await import('../config/env')
    resetEnv()
  })

  it('lets Bachs select the eligible card rail for a subscription', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      checkout_id: 'chk_test',
      checkout_url: 'https://checkout.bachs.io/c/test',
      status: 'open'
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const { createSubscriptionCheckout } = await import('./bachs')
    await createSubscriptionCheckout({
      productId: 'prod_test',
      quantity: 1,
      reference: 'schedra-test',
      customer: { email: 'owner@example.com', name: 'Example team' },
      successUrl: 'https://staging.schedra.xyz/paid',
      cancelUrl: 'https://staging.schedra.xyz/billing',
      metadata: { organizationId: 'org_test' }
    })

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(request.body)) as Record<string, unknown>
    expect(body.billing_currency).toBe('USD')
    expect(body.payment_method_options).toBeUndefined()
  })

  it('uses the documented card key for one-time NGN checkout restrictions', async () => {
    const { NGN_ONE_TIME_PAYMENT_METHOD_OPTIONS } = await import('./bachs')

    expect(NGN_ONE_TIME_PAYMENT_METHOD_OPTIONS).toEqual({
      bank_transfer: { currencies: ['NGN'] },
      card: { currencies: ['NGN'] }
    })
    expect(NGN_ONE_TIME_PAYMENT_METHOD_OPTIONS).not.toHaveProperty('ngn_card')
  })

  it('turns an unavailable live payment method into an actionable service error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      detail: 'This restriction leaves no payment method available for this checkout',
      error_code: 'CHECKOUT_RESTRICTION_LEAVES_NO_PAYMENT_METHOD'
    }), { status: 400, headers: { 'content-type': 'application/json' } })))

    const { createSubscriptionCheckout } = await import('./bachs')
    await expect(createSubscriptionCheckout({
      productId: 'prod_test',
      quantity: 1,
      reference: 'schedra-test-error',
      customer: { email: 'owner@example.com', name: 'Example team' },
      successUrl: 'https://staging.schedra.xyz/paid',
      cancelUrl: 'https://staging.schedra.xyz/billing',
      metadata: { organizationId: 'org_test' }
    })).rejects.toMatchObject({
      statusCode: 503,
      data: { errorCode: 'CHECKOUT_RESTRICTION_LEAVES_NO_PAYMENT_METHOD' }
    })
  })
})
