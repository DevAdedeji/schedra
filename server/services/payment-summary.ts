import type { PaymentCurrency } from '#shared/payments'
import {
  getConnectedAccountBalance,
  listConnectedAccountPayouts
} from '../integrations/bachs'
import { collectedPaymentTotals } from '../repositories/payment-ledger'
import { logEvent } from '../observability/logger'
import {
  findPaymentRecipient,
  type PaymentRecipientOwner
} from './payment-recipient'

export interface MoneyTotal {
  currency: PaymentCurrency
  amountCents: number
}

function currency(value?: string | null): PaymentCurrency | null {
  const normalized = value?.toUpperCase()
  return normalized === 'USD' || normalized === 'NGN' ? normalized : null
}

function cents(value?: string | null) {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
}

function addTotal(totals: Map<PaymentCurrency, number>, code: PaymentCurrency, amount: number) {
  totals.set(code, (totals.get(code) ?? 0) + amount)
}

function serialize(totals: Map<PaymentCurrency, number>): MoneyTotal[] {
  return [...totals.entries()]
    .map(([currency, amountCents]) => ({ currency, amountCents }))
    .sort((left, right) => left.currency.localeCompare(right.currency))
}

export async function paymentSummary(owner: PaymentRecipientOwner) {
  const [recipient, collected] = await Promise.all([
    findPaymentRecipient(owner),
    collectedPaymentTotals(owner)
  ])
  if (!recipient?.bachsAccountId) {
    return {
      collected,
      available: [] as MoneyTotal[],
      pending: [] as MoneyTotal[],
      withdrawn: [] as MoneyTotal[],
      providerStatus: 'not_connected' as const,
      updatedAt: new Date().toISOString()
    }
  }

  try {
    const [balance, payouts] = await Promise.all([
      getConnectedAccountBalance(recipient.bachsAccountId),
      listConnectedAccountPayouts(recipient.bachsAccountId)
    ])
    const available = new Map<PaymentCurrency, number>()
    const pending = new Map<PaymentCurrency, number>()
    const withdrawn = new Map<PaymentCurrency, number>()

    for (const bucket of balance.balances ?? []) {
      const code = currency(bucket.currency)
      if (!code) continue
      addTotal(available, code, cents(bucket.available_balance))
      addTotal(pending, code, cents(bucket.pending_balance))
    }
    for (const payout of payouts) {
      if (payout.status !== 'completed') continue
      const code = currency(payout.currency)
      if (code) addTotal(withdrawn, code, cents(payout.amount))
    }

    return {
      collected,
      available: serialize(available),
      pending: serialize(pending),
      withdrawn: serialize(withdrawn),
      providerStatus: 'available' as const,
      updatedAt: new Date().toISOString()
    }
  } catch (error) {
    logEvent('warn', 'payment_summary_provider_unavailable', {
      recipientId: recipient.id,
      error: error instanceof Error ? error.message : 'Unknown provider error'
    })
    return {
      collected,
      available: [] as MoneyTotal[],
      pending: [] as MoneyTotal[],
      withdrawn: [] as MoneyTotal[],
      providerStatus: 'unavailable' as const,
      updatedAt: new Date().toISOString()
    }
  }
}
