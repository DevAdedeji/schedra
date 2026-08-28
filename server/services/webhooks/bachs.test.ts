import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCheckoutSession } from '../../integrations/bachs'
import { completePaidBookingFromCheckout } from '../paid-booking'
import { processBachsWebhook } from './bachs'

vi.mock('../../integrations/bachs', () => ({
  getCheckoutSession: vi.fn(),
  getConnectedAccount: vi.fn()
}))
vi.mock('../paid-booking', () => ({
  applyRefundEvent: vi.fn(),
  completePaidBookingFromCheckout: vi.fn(),
  failPaidBooking: vi.fn(),
  recordPaidBookingProviderObservation: vi.fn()
}))
vi.mock('../billing', () => ({
  applySubscriptionState: vi.fn(),
  markInvoiceFailed: vi.fn(),
  markInvoicePaid: vi.fn()
}))
vi.mock('../organization', () => ({ recordAudit: vi.fn() }))
vi.mock('../payment-recipient', () => ({ updateRecipientFromWebhook: vi.fn() }))

describe('Bachs paid-booking webhooks', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['checkout.completed', 'collection.succeeded'])('verifies %s against the checkout resource', async (type) => {
    const checkout = {
      checkout_id: 'chk_123',
      status: 'completed' as const,
      payment_status: 'succeeded' as const,
      amount: '5.00',
      currency: 'USD',
      reference: 'booking-reference',
      charge: {
        payment_id: 'pay_123',
        status: 'succeeded' as const,
        amount: '5.00',
        amount_paid: '5.00',
        currency: 'USD'
      }
    }
    vi.mocked(getCheckoutSession).mockResolvedValue(checkout)
    vi.mocked(completePaidBookingFromCheckout).mockResolvedValue({ matched: true, applied: true })

    const result = await processBachsWebhook({
      id: 'evt_123',
      type,
      data: {
        checkout_id: 'chk_123',
        // Collection payload money can use a settlement representation. It
        // must never replace the checkout's immutable base price.
        amount: '475',
        amount_collected: '4.75',
        currency: 'USD'
      }
    })

    expect(getCheckoutSession).toHaveBeenCalledWith('chk_123')
    expect(completePaidBookingFromCheckout).toHaveBeenCalledWith(checkout, {
      amountCollectedCents: 475,
      amountCollectedCurrency: 'USD',
      providerEventId: 'evt_123'
    })
    expect(result).toEqual({ received: true, applied: true })
  })
})
