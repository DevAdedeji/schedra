import { describe, expect, it } from 'vitest'
import type { BachsCheckoutSession } from '../integrations/bachs'
import { checkoutPaymentState } from './paid-booking'

function checkout(overrides: Partial<BachsCheckoutSession> = {}): BachsCheckoutSession {
  return {
    checkout_id: 'chk_paid_booking',
    status: 'open',
    payment_status: 'processing',
    amount: '5.00',
    currency: 'USD',
    reference: 'booking-reference',
    ...overrides
  }
}

describe('paid booking checkout state', () => {
  it('only accepts a terminal checkout with a successful provider payment', () => {
    expect(checkoutPaymentState(checkout({
      status: 'completed',
      payment_status: 'succeeded',
      charge: {
        payment_id: 'pay_123',
        status: 'succeeded',
        amount: '5.00',
        amount_paid: '5.00',
        currency: 'USD'
      }
    }))).toBe('paid')
  })

  it('does not trust a completed redirect while the payment is still processing', () => {
    expect(checkoutPaymentState(checkout({ status: 'completed' }))).toBe('pending')
  })

  it('accepts a provider-confirmed charge even when checkout state lags behind', () => {
    expect(checkoutPaymentState(checkout({
      status: 'expired',
      payment_status: 'processing',
      charge: {
        payment_id: 'pay_late',
        status: 'succeeded',
        amount: '5.00',
        amount_paid: '5.00',
        currency: 'USD'
      }
    }))).toBe('paid')
  })

  it('treats expired and failed checkouts as terminal failures', () => {
    expect(checkoutPaymentState(checkout({ status: 'expired' }))).toBe('failed')
    expect(checkoutPaymentState(checkout({
      status: 'completed',
      payment_status: 'failed'
    }))).toBe('failed')
  })
})
