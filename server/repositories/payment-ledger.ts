import { and, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import type { Database } from '../database/client'
import {
  bookingPayments,
  bookings,
  eventTypes,
  organizations,
  paymentLedgerEntries,
  paymentRecipients,
  users
} from '../database/schema'
import { useDatabase } from '../database'
import type {
  PaymentActivityQuery,
  PaymentLedgerDirection,
  PaymentLedgerKind,
  PaymentLedgerStatus
} from '#shared/payment-ledger'

type LedgerExecutor = Pick<Database, 'insert'>
type LedgerMetadata = Record<string, string | number | boolean | null>

export async function appendPaymentLedgerEntry(input: {
  bookingPaymentId: string
  dedupeKey: string
  kind: PaymentLedgerKind
  direction: PaymentLedgerDirection
  status: PaymentLedgerStatus
  amountCents?: number | null
  currency: 'USD' | 'NGN'
  providerEventId?: string | null
  providerObjectId?: string | null
  message?: string | null
  metadata?: LedgerMetadata
  occurredAt?: Date
}, executor: LedgerExecutor = useDatabase()) {
  const [entry] = await executor.insert(paymentLedgerEntries).values({
    ...input,
    provider: 'bachs',
    message: input.message?.slice(0, 1000) ?? null,
    metadata: input.metadata ?? {}
  }).onConflictDoNothing({ target: paymentLedgerEntries.dedupeKey }).returning({ id: paymentLedgerEntries.id })
  return entry ?? null
}

export type PaymentActivityOwner
  = { userId: string, organizationId?: never }
    | { organizationId: string, userId?: never }

function ownerWhere(owner: PaymentActivityOwner) {
  return 'userId' in owner && owner.userId
    ? eq(paymentRecipients.userId, owner.userId)
    : eq(paymentRecipients.organizationId, owner.organizationId!)
}

export async function paymentActivityRows(
  owner: PaymentActivityOwner | null,
  query: PaymentActivityQuery,
  kinds?: PaymentLedgerKind[]
) {
  const db = useDatabase()
  const search = query.search
    ? or(
        ilike(bookings.attendeeName, `%${query.search}%`),
        ilike(bookings.attendeeEmail, `%${query.search}%`),
        ilike(eventTypes.title, `%${query.search}%`),
        ilike(bookingPayments.reference, `%${query.search}%`),
        ilike(paymentLedgerEntries.providerObjectId, `%${query.search}%`),
        ilike(users.name, `%${query.search}%`),
        ilike(users.email, `%${query.search}%`),
        ilike(organizations.name, `%${query.search}%`)
      )
    : undefined
  const where = and(
    owner ? ownerWhere(owner) : undefined,
    kinds?.length ? inArray(paymentLedgerEntries.kind, kinds) : undefined,
    query.direction === 'all' ? undefined : eq(paymentLedgerEntries.direction, query.direction),
    query.status === 'all' ? undefined : eq(paymentLedgerEntries.status, query.status),
    search
  )

  const base = db.select({
    id: paymentLedgerEntries.id,
    kind: paymentLedgerEntries.kind,
    direction: paymentLedgerEntries.direction,
    status: paymentLedgerEntries.status,
    amountCents: paymentLedgerEntries.amountCents,
    currency: paymentLedgerEntries.currency,
    provider: paymentLedgerEntries.provider,
    providerEventId: paymentLedgerEntries.providerEventId,
    providerObjectId: paymentLedgerEntries.providerObjectId,
    message: paymentLedgerEntries.message,
    metadata: paymentLedgerEntries.metadata,
    occurredAt: paymentLedgerEntries.occurredAt,
    paymentReference: bookingPayments.reference,
    bookingAmountCents: bookingPayments.amountCents,
    bookingCurrency: bookingPayments.currency,
    platformFeeCents: bookingPayments.platformFeeCents,
    bookingUid: bookings.uid,
    attendeeName: bookings.attendeeName,
    attendeeEmail: bookings.attendeeEmail,
    eventTitle: eventTypes.title,
    ownerUserName: users.name,
    ownerUserEmail: users.email,
    organizationName: organizations.name
  }).from(paymentLedgerEntries)
    .innerJoin(bookingPayments, eq(bookingPayments.id, paymentLedgerEntries.bookingPaymentId))
    .innerJoin(paymentRecipients, eq(paymentRecipients.id, bookingPayments.recipientId))
    .leftJoin(users, eq(users.id, paymentRecipients.userId))
    .leftJoin(organizations, eq(organizations.id, paymentRecipients.organizationId))
    .innerJoin(bookings, eq(bookings.id, bookingPayments.bookingId))
    .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))

  const [[total], rows] = await Promise.all([
    db.select({ value: count() }).from(paymentLedgerEntries)
      .innerJoin(bookingPayments, eq(bookingPayments.id, paymentLedgerEntries.bookingPaymentId))
      .innerJoin(paymentRecipients, eq(paymentRecipients.id, bookingPayments.recipientId))
      .leftJoin(users, eq(users.id, paymentRecipients.userId))
      .leftJoin(organizations, eq(organizations.id, paymentRecipients.organizationId))
      .innerJoin(bookings, eq(bookings.id, bookingPayments.bookingId))
      .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
      .where(where),
    base.where(where)
      .orderBy(desc(paymentLedgerEntries.occurredAt), desc(paymentLedgerEntries.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)
  ])

  return { rows, total: total?.value ?? 0 }
}

export async function collectedPaymentTotals(owner: PaymentActivityOwner) {
  const rows = await useDatabase().select({
    currency: bookingPayments.currency,
    amountCents: sql<number>`sum(${bookingPayments.amountCents})::bigint`.mapWith(Number)
  }).from(bookingPayments)
    .innerJoin(paymentRecipients, eq(paymentRecipients.id, bookingPayments.recipientId))
    .where(and(
      ownerWhere(owner),
      inArray(bookingPayments.status, ['paid', 'refund_pending', 'refunded', 'refund_failed'])
    ))
    .groupBy(bookingPayments.currency)

  return rows.map(row => ({
    currency: row.currency as 'USD' | 'NGN',
    amountCents: Number(row.amountCents)
  }))
}
