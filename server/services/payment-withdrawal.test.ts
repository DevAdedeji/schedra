import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createConnectedAccountPayoutQuote,
  estimateConnectedAccountPayout,
  getConnectedAccountBalance,
  listConnectedAccountPayoutDestinations
} from '../integrations/bachs'
import { findPaymentRecipient, syncPaymentRecipient } from './payment-recipient'
import { createPaymentWithdrawal, previewPaymentWithdrawal, withdrawalTransitionStates } from './payment-withdrawal'

vi.mock('../integrations/bachs', () => ({
  createConnectedAccountPayout: vi.fn(),
  createConnectedAccountPayoutQuote: vi.fn(),
  estimateConnectedAccountPayout: vi.fn(),
  getConnectedAccountBalance: vi.fn(),
  getConnectedAccountPayout: vi.fn(),
  listConnectedAccountPayoutDestinations: vi.fn(),
  listConnectedAccountPayouts: vi.fn()
}))
vi.mock('./payment-recipient', () => ({
  findPaymentRecipient: vi.fn(),
  syncPaymentRecipient: vi.fn()
}))
vi.mock('../config/env', () => ({ useEnv: () => ({ authSecret: 'x'.repeat(32) }) }))
vi.mock('../database', () => ({ useDatabase: vi.fn() }))
vi.mock('../observability/logger', () => ({ logEvent: vi.fn() }))

const recipient = {
  id: 'recipient-1',
  bachsAccountId: 'acct_1',
  status: 'active'
}
const destination = {
  id: 'pd_ngn',
  name: 'Primary bank',
  type: 'bank_account' as const,
  currency: 'NGN',
  status: 'approved' as const,
  is_usable: true,
  is_default: true
}

describe('payment withdrawal previews', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('createError', (input: { statusCode: number, statusMessage: string }) => (
      Object.assign(new Error(input.statusMessage), input)
    ))
    vi.mocked(findPaymentRecipient).mockResolvedValue(recipient as never)
    vi.mocked(syncPaymentRecipient).mockResolvedValue(recipient as never)
    vi.mocked(listConnectedAccountPayoutDestinations).mockResolvedValue([destination])
  })

  it('shows the fee on top before a same-currency withdrawal can be confirmed', async () => {
    vi.mocked(getConnectedAccountBalance).mockResolvedValue({
      account_id: 'acct_1',
      total_balance_usd: '0.00',
      balances: [{ currency: 'NGN', available_balance: '10000.00', pending_balance: '0.00' }]
    })
    vi.mocked(estimateConnectedAccountPayout).mockResolvedValue({
      from_currency: 'NGN',
      to_currency: 'NGN',
      amount: '5000.00',
      payout_method: 'BANK_TRANSFER',
      withdrawal_fee: '100.00',
      gross_from_amount: '5100.00',
      to_amount: '5000.00'
    })

    await expect(previewPaymentWithdrawal({ userId: 'user-1' }, {
      destinationId: 'pd_ngn',
      sourceCurrency: 'NGN',
      amountCents: 500_000
    })).resolves.toMatchObject({
      requestedAmountCents: 500_000,
      deliveredAmountCents: 500_000,
      feeCents: 10_000,
      totalDebitedCents: 510_000,
      sourceCurrency: 'NGN',
      destinationCurrency: 'NGN'
    })
  })

  it('uses a short-lived quote when a USD balance is withdrawn to an NGN bank', async () => {
    vi.mocked(getConnectedAccountBalance).mockResolvedValue({
      account_id: 'acct_1',
      total_balance_usd: '10.00',
      balances: [{ currency: 'USD', available_balance: '10.00', pending_balance: '0.00' }]
    })
    vi.mocked(estimateConnectedAccountPayout).mockResolvedValue({
      from_currency: 'USD',
      to_currency: 'NGN',
      amount: '5.00',
      payout_method: 'BANK_TRANSFER',
      withdrawal_fee: '1.00',
      gross_from_amount: '6.00',
      exchange_rate: '1600.00',
      to_amount: '8000.00'
    })
    vi.mocked(createConnectedAccountPayoutQuote).mockResolvedValue({
      quote_id: 'pqt_1',
      from_currency: 'USD',
      to_currency: 'NGN',
      from_amount: '5.00',
      to_amount: '7800.00',
      exchange_rate: '1600.00',
      expires_at: new Date(Date.now() + 60_000).toISOString()
    })

    const result = await previewPaymentWithdrawal({ userId: 'user-1' }, {
      destinationId: 'pd_ngn',
      sourceCurrency: 'USD',
      amountCents: 500
    })

    expect(result).toMatchObject({
      requestedAmountCents: 500,
      deliveredAmountCents: 780_000,
      feeCents: 100,
      totalDebitedCents: 600,
      sourceCurrency: 'USD',
      destinationCurrency: 'NGN',
      exchangeRate: '1600.00'
    })
    expect(createConnectedAccountPayoutQuote).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'acct_1',
      fromCurrency: 'USD',
      toCurrency: 'NGN',
      amount: '5.00',
      payoutMethod: 'BANK_TRANSFER'
    }))
  })

  it('blocks a cross-currency withdrawal when the amount plus fee exceeds the balance', async () => {
    vi.mocked(getConnectedAccountBalance).mockResolvedValue({
      account_id: 'acct_1',
      total_balance_usd: '0.95',
      balances: [{ currency: 'USD', available_balance: '0.95', pending_balance: '0.00' }]
    })
    vi.mocked(estimateConnectedAccountPayout).mockResolvedValue({
      from_currency: 'USD',
      to_currency: 'NGN',
      amount: '0.50',
      payout_method: 'BANK_TRANSFER',
      withdrawal_fee: '1.00',
      gross_from_amount: '1.50',
      exchange_rate: '1600.00',
      to_amount: '800.00'
    })

    await expect(previewPaymentWithdrawal({ userId: 'user-1' }, {
      destinationId: 'pd_ngn',
      sourceCurrency: 'USD',
      amountCents: 50
    })).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'This withdrawal requires USD 1.50 including the Bachs fee, but only USD 0.95 is available.'
    })
    expect(createConnectedAccountPayoutQuote).not.toHaveBeenCalled()
  })

  it('fails closed when amount plus provider fee exceeds the available balance', async () => {
    vi.mocked(getConnectedAccountBalance).mockResolvedValue({
      account_id: 'acct_1',
      total_balance_usd: '0.00',
      balances: [{ currency: 'NGN', available_balance: '5000.00', pending_balance: '0.00' }]
    })
    vi.mocked(estimateConnectedAccountPayout).mockResolvedValue({
      from_currency: 'NGN',
      to_currency: 'NGN',
      amount: '5000.00',
      payout_method: 'BANK_TRANSFER',
      withdrawal_fee: '100.00',
      gross_from_amount: '5100.00',
      to_amount: '5000.00'
    })

    await expect(previewPaymentWithdrawal({ userId: 'user-1' }, {
      destinationId: 'pd_ngn',
      sourceCurrency: 'NGN',
      amountCents: 500_000
    })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('rejects a tampered confirmation before any money boundary is called', async () => {
    vi.mocked(getConnectedAccountBalance).mockResolvedValue({
      account_id: 'acct_1',
      total_balance_usd: '0.00',
      balances: [{ currency: 'NGN', available_balance: '10000.00', pending_balance: '0.00' }]
    })
    vi.mocked(estimateConnectedAccountPayout).mockResolvedValue({
      from_currency: 'NGN',
      to_currency: 'NGN',
      amount: '5000.00',
      payout_method: 'BANK_TRANSFER',
      withdrawal_fee: '100.00',
      gross_from_amount: '5100.00',
      to_amount: '5000.00'
    })
    const preview = await previewPaymentWithdrawal({ userId: 'user-1' }, {
      destinationId: 'pd_ngn',
      sourceCurrency: 'NGN',
      amountCents: 500_000
    })

    await expect(createPaymentWithdrawal({
      owner: { userId: 'user-1' },
      actorUserId: 'user-1',
      request: {
        requestId: crypto.randomUUID(),
        confirmationToken: `${preview.confirmationToken}changed`
      }
    })).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('withdrawal provider ordering', () => {
  it('never lets a delayed provider event overwrite a completed payout', () => {
    expect(withdrawalTransitionStates('completed')).toContain('failed')
    expect(withdrawalTransitionStates('failed')).not.toContain('completed')
    expect(withdrawalTransitionStates('processing')).not.toContain('completed')
    expect(withdrawalTransitionStates('pending')).not.toContain('processing')
  })
})
