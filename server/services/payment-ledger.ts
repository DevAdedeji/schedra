import { paginationMeta } from '#shared/pagination'
import type { PaymentActivityQuery, PaymentLedgerKind } from '#shared/payment-ledger'
import { paymentActivityRows, type PaymentActivityOwner } from '../repositories/payment-ledger'

const kindCopy: Record<PaymentLedgerKind, { label: string, icon: string }> = {
  checkout: { label: 'Checkout', icon: 'i-lucide-credit-card' },
  customer_payment: { label: 'Customer payment', icon: 'i-lucide-arrow-down-left' },
  platform_fee: { label: 'Schedra fee', icon: 'i-lucide-receipt-text' },
  processing_fee: { label: 'Processing fee', icon: 'i-lucide-landmark' },
  settlement: { label: 'Settlement', icon: 'i-lucide-wallet-cards' },
  refund: { label: 'Refund', icon: 'i-lucide-undo-2' }
}

function parties(kind: PaymentLedgerKind, attendee: string, owner: string) {
  if (kind === 'platform_fee') return { from: owner, to: 'Schedra' }
  if (kind === 'processing_fee') return { from: owner, to: 'Bachs' }
  if (kind === 'settlement') return { from: 'Bachs', to: owner }
  if (kind === 'refund') return { from: owner, to: attendee }
  return { from: attendee, to: owner }
}

export async function listPaymentActivity(
  owner: PaymentActivityOwner,
  ownerLabel: string,
  query: PaymentActivityQuery,
  audience: 'account' | 'operator' = 'account'
) {
  const { rows, total } = await paymentActivityRows(
    owner,
    query,
    audience === 'account' ? ['customer_payment', 'settlement', 'refund'] : undefined
  )
  return paymentActivityResponse(rows, total, query, () => ownerLabel, false)
}

export async function listOperationsPaymentActivity(query: PaymentActivityQuery) {
  const { rows, total } = await paymentActivityRows(null, query)
  return paymentActivityResponse(
    rows,
    total,
    query,
    row => row.organizationName ?? row.ownerUserName ?? row.ownerUserEmail ?? 'Payout account',
    true
  )
}

type ActivityRow = Awaited<ReturnType<typeof paymentActivityRows>>['rows'][number]

export function paymentActivityMoney(
  kind: PaymentLedgerKind,
  row: Pick<ActivityRow, 'amountCents' | 'currency' | 'bookingAmountCents' | 'bookingCurrency'>
) {
  return kind === 'customer_payment'
    ? { amountCents: row.bookingAmountCents, currency: row.bookingCurrency }
    : { amountCents: row.amountCents, currency: row.currency }
}

function paymentActivityResponse(
  rows: ActivityRow[],
  total: number,
  query: PaymentActivityQuery,
  ownerLabel: (row: ActivityRow) => string,
  operator: boolean
) {
  return {
    items: rows.map((row) => {
      const kind = row.kind as PaymentLedgerKind
      const owner = ownerLabel(row)
      // A provider may collect a USD-priced booking through a local NGN rail.
      // Customer payment activity is the immutable event price, not the
      // provider's tender/settlement amount. This also safely repairs the
      // presentation of older append-only entries that stored the tender value.
      const { amountCents, currency } = paymentActivityMoney(kind, row)
      return {
        id: row.id,
        kind,
        direction: row.direction,
        status: row.status,
        amountCents,
        currency,
        provider: row.provider,
        providerEventId: operator ? row.providerEventId : null,
        providerObjectId: operator ? row.providerObjectId : null,
        message: operator ? row.message : null,
        metadata: operator ? row.metadata : {},
        occurredAt: row.occurredAt.toISOString(),
        paymentReference: row.paymentReference,
        platformFeeCents: operator ? row.platformFeeCents : null,
        attendeeName: row.attendeeName,
        attendeeEmail: row.attendeeEmail,
        eventTitle: row.eventTitle,
        ...kindCopy[kind],
        ...parties(kind, row.attendeeName, owner),
        owner,
        bookingPath: `/booking/${row.bookingUid}`
      }
    }),
    pagination: paginationMeta(total, query.page, query.pageSize)
  }
}
