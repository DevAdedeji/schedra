import { describe, expect, it } from 'vitest'
import { paymentActivityMoney } from './payment-ledger'

describe('payment activity money', () => {
  const convertedCharge = {
    amountCents: 739_113,
    currency: 'NGN',
    bookingAmountCents: 500,
    bookingCurrency: 'USD'
  }

  it('shows a customer payment using the immutable event price', () => {
    expect(paymentActivityMoney('customer_payment', convertedCharge)).toEqual({
      amountCents: 500,
      currency: 'USD'
    })
  })

  it('keeps provider settlement money in its own currency', () => {
    expect(paymentActivityMoney('settlement', convertedCharge)).toEqual({
      amountCents: 739_113,
      currency: 'NGN'
    })
  })
})
