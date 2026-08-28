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
  const accountQuery = audience === 'account'
    ? { ...query, status: 'succeeded' as const }
    : query
  const { rows, total } = await paymentActivityRows(
    owner,
    accountQuery,
    audience === 'account' ? ['customer_payment', 'settlement'] : undefined
  )
  return paymentActivityResponse(rows, total, accountQuery, () => ownerLabel, false)
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
      return {
        id: row.id,
        kind,
        direction: row.direction,
        status: row.status,
        amountCents: row.amountCents,
        currency: row.currency,
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
