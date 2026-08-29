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

  it('creates a destination checkout with an immutable price and platform fee', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      checkout_id: 'chk_paid_booking',
      checkout_url: 'https://checkout.bachs.io/c/paid-booking',
      status: 'open',
      amount: '25.00',
      currency: 'USD',
      reference: 'booking-uid'
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { createCheckoutSession } = await import('./bachs')
    await createCheckoutSession({
      amount: '25.00',
      currency: 'USD',
      reference: 'booking-uid',
      customer: { email: 'guest@example.com', name: 'Guest' },
      successUrl: 'https://schedra.xyz/booking/uid',
      cancelUrl: 'https://schedra.xyz/booking/uid?payment=cancelled',
      metadata: { schedra_booking_uid: 'uid' },
      platformFee: '1.25',
      destinationAccountId: 'acct_host',
      expiresInMinutes: 60
    })

    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))
    expect(body).toMatchObject({
      pricing: { currency: 'USD', amount: '25.00', price_type: 'fixed' },
      platform_fee: '1.25',
      transfer_data: { destination: 'acct_host' },
      expires_in_minutes: 60
    })
  })

  it('reads a checkout from Bachs before confirming a paid booking', async () => {
    const providerCheckout = {
      checkout_id: 'chk_paid_booking',
      status: 'completed',
      payment_status: 'succeeded',
      amount: '5.00',
      currency: 'USD',
      reference: 'booking-reference',
      charge: {
        payment_id: 'pay_123',
        status: 'succeeded',
        amount: '5.00',
        amount_paid: '5.00',
        currency: 'USD'
      }
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(providerCheckout), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { getCheckoutSession } = await import('./bachs')
    await expect(getCheckoutSession('chk_paid_booking')).resolves.toEqual(providerCheckout)
    expect(fetchMock.mock.calls[0]?.[0].toString()).toBe(
      'https://sandbox-api.bachs.io/v1/checkout-sessions/chk_paid_booking'
    )
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe('GET')
  })

  it('retries a transient checkout read before webhook processing fails', async () => {
    const providerCheckout = {
      checkout_id: 'chk_retry',
      status: 'completed',
      payment_status: 'succeeded',
      amount: '5.00',
      currency: 'USD',
      reference: 'booking-reference'
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(providerCheckout), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { getCheckoutSession } = await import('./bachs')
    await expect(getCheckoutSession('chk_retry')).resolves.toEqual(providerCheckout)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a non-transient checkout rejection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      detail: 'Checkout not found'
    }), { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    const { getCheckoutSession } = await import('./bachs')
    await expect(getCheckoutSession('chk_missing')).rejects.toMatchObject({ statusCode: 404 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never retries a write that has no idempotency key', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ created: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { bachsFetch } = await import('./bachs')
    await expect(bachsFetch('/unsafe-write', {
      method: 'POST',
      body: { amount: '5.00' }
    })).rejects.toMatchObject({ statusCode: 502 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses owner identity, not email, to make payout account creation idempotent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'acct_host' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { createConnectedAccount } = await import('./bachs')
    await createConnectedAccount({
      email: 'shared@example.com',
      name: 'Example team',
      firstName: 'Ada',
      lastName: 'Okafor',
      reference: 'organization-org_123',
      entityType: 'company'
    })

    const options = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://sandbox-api.bachs.io/v1/accounts')
    expect(new Headers(options.headers).get('Idempotency-Key')).toBe('schedra-recipient-organization-org_123')
    expect(JSON.parse(String(options.body))).toMatchObject({
      entity_type: 'company',
      first_name: 'Ada',
      last_name: 'Okafor'
    })
  })

  it('prefills an outstanding representative without collecting sensitive details', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'acct_host' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { updateConnectedAccountRepresentative } = await import('./bachs')
    await updateConnectedAccountRepresentative({
      accountId: 'acct_host',
      firstName: 'Ada',
      lastName: 'Okafor'
    })

    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://sandbox-api.bachs.io/v1/accounts/acct_host')
    expect(JSON.parse(String(options.body))).toEqual({
      fields: {
        persons: [{
          first_name: 'Ada',
          last_name: 'Okafor',
          relationship: { representative: true }
        }]
      }
    })
  })

  it('uses the account resource to read a connected payout account', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'acct_host',
      capabilities: { payouts: { status: 'pending', requested: true } }
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { getConnectedAccount } = await import('./bachs')
    await getConnectedAccount('acct_host/unsafe')

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://sandbox-api.bachs.io/v1/accounts/acct_host%2Funsafe'
    )
  })

  it('scopes balances and payouts to the connected account', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        account_id: 'acct_host', balances: [], total_balance_usd: '0.00'
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total: 0, items: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { getConnectedAccountBalance, listConnectedAccountPayouts } = await import('./bachs')
    await getConnectedAccountBalance('acct_host')
    await listConnectedAccountPayouts('acct_host')

    for (const call of fetchMock.mock.calls) {
      const headers = new Headers((call[1] as RequestInit).headers)
      expect(headers.get('X-Account-Id')).toBe('acct_host')
    }
  })

  it('reads reviewed payout destinations in the connected account context', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      destinations: [{
        id: 'pd_ready',
        name: 'Primary bank',
        type: 'bank_account',
        currency: 'NGN',
        status: 'approved',
        is_usable: true,
        is_default: true
      }],
      total: 1,
      limit: 100,
      offset: 0
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { listConnectedAccountPayoutDestinations } = await import('./bachs')
    await expect(listConnectedAccountPayoutDestinations('acct_host')).resolves.toHaveLength(1)

    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://sandbox-api.bachs.io/v1/payouts/destinations?limit=100&offset=0')
    expect(new Headers(options.headers).get('X-Account-Id')).toBe('acct_host')
  })

  it('previews a same-currency payout fee in the connected account context', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      from_currency: 'NGN',
      to_currency: 'NGN',
      amount: '5000.00',
      payout_method: 'BANK_TRANSFER',
      withdrawal_fee: '100.00',
      gross_from_amount: '5100.00',
      to_amount: '5000.00'
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { estimateConnectedAccountPayout } = await import('./bachs')
    await estimateConnectedAccountPayout({
      accountId: 'acct_host',
      fromCurrency: 'NGN',
      toCurrency: 'NGN',
      amount: '5000.00',
      payoutMethod: 'BANK_TRANSFER'
    })

    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://sandbox-api.bachs.io/v1/payouts/estimate')
    expect(new Headers(options.headers).get('X-Account-Id')).toBe('acct_host')
    expect(JSON.parse(String(options.body))).toEqual({
      from_currency: 'NGN',
      to_currency: 'NGN',
      amount: '5000.00',
      payout_method: 'BANK_TRANSFER'
    })
  })

  it('quotes a cross-currency connected-account payout', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      quote_id: 'pqt_123',
      from_currency: 'USD',
      to_currency: 'NGN',
      from_amount: '5.00',
      to_amount: '7800.00',
      exchange_rate: '1600.00',
      expires_at: '2026-08-30T12:00:00.000Z'
    }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    const { createConnectedAccountPayoutQuote } = await import('./bachs')
    await createConnectedAccountPayoutQuote({
      accountId: 'acct_host',
      fromCurrency: 'USD',
      toCurrency: 'NGN',
      amount: '5.00',
      payoutMethod: 'BANK_TRANSFER'
    })

    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://sandbox-api.bachs.io/v1/payouts/quotes')
    expect(new Headers(options.headers).get('X-Account-Id')).toBe('acct_host')
    expect(JSON.parse(String(options.body))).toMatchObject({
      from_currency: 'USD',
      to_currency: 'NGN',
      amount: '5.00',
      payout_method: 'BANK_TRANSFER'
    })
  })

  it('creates an idempotent connected-account withdrawal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'pay_123',
      status: 'pending',
      amount: '5000.00',
      currency: 'NGN',
      source_currency: 'NGN',
      fee: '100.00',
      total_debited: '5100.00',
      destination: 'pd_ready',
      reference: 'schedra-wd-123'
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { createConnectedAccountPayout } = await import('./bachs')
    await createConnectedAccountPayout({
      accountId: 'acct_host',
      destinationId: 'pd_ready',
      amount: '5000.00',
      reference: 'schedra-wd-123',
      metadata: { schedra_withdrawal_id: '123' }
    })

    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit]
    const headers = new Headers(options.headers)
    expect(String(url)).toBe('https://sandbox-api.bachs.io/v1/payouts')
    expect(headers.get('X-Account-Id')).toBe('acct_host')
    expect(headers.get('Idempotency-Key')).toBe('schedra-wd-123')
    expect(JSON.parse(String(options.body))).toEqual({
      destination: 'pd_ready',
      reference: 'schedra-wd-123',
      amount: '5000.00',
      metadata: { schedra_withdrawal_id: '123' }
    })
  })

  it('creates onboarding links through the account resource', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'alnk_test',
      account: 'acct_host',
      url: 'https://connect.bachs.io/setup/test',
      expires_at: '2026-09-06T11:04:22.518Z'
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { createConnectedAccountLink } = await import('./bachs')
    await createConnectedAccountLink({
      accountId: 'acct_host',
      refreshUrl: 'https://staging.schedra.xyz/payments?payments=refresh',
      returnUrl: 'https://staging.schedra.xyz/payments?payments=returned'
    })

    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe(
      'https://sandbox-api.bachs.io/v1/accounts/acct_host/account-links'
    )
    expect(JSON.parse(String(options.body))).toEqual({
      type: 'onboarding',
      refresh_url: 'https://staging.schedra.xyz/payments?payments=refresh',
      return_url: 'https://staging.schedra.xyz/payments?payments=returned'
    })
  })

  it('creates update links for completed payout accounts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'alnk_update',
      account: 'acct_host',
      url: 'https://connect.bachs.io/update/test',
      expires_at: '2026-09-06T11:04:22.518Z'
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { createConnectedAccountLink } = await import('./bachs')
    await createConnectedAccountLink({
      accountId: 'acct_host',
      type: 'update',
      refreshUrl: 'https://staging.schedra.xyz/payments?payments=refresh',
      returnUrl: 'https://staging.schedra.xyz/payments?payments=returned'
    })

    const options = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(options.body))).toMatchObject({ type: 'update' })
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
