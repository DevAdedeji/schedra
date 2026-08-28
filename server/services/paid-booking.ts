import { and, eq, inArray, lte, sql } from 'drizzle-orm'
import type { Database } from '../database/client'
import {
  bookingPayments,
  bookings,
  eventTypes,
  paymentRecipients
} from '../database/schema'
import { useDatabase } from '../database'
import { createCheckoutSession, createRefund } from '../integrations/bachs'
import { toDecimalString } from '#shared/billing'
import { useEnv } from '../config/env'
import { assignedHostsForBooking, findBookingByUid } from '../repositories/booking'
import { bookingNoticeFromManaged, queueBookingEmails } from './booking-emails'
import { enqueueCalendarSync } from './calendar-sync'
import { publishBookingEvent } from './workflows'

type PaymentExecutor = Pick<Database, 'insert' | 'select' | 'update'>

export function platformFeeCents(amountCents: number) {
  const fee = Math.round(amountCents * useEnv().paidBookingPlatformFeeBps / 10_000)
  return Math.min(amountCents - 1, Math.max(1, fee))
}

export async function readyPaymentRecipient(owner: { userId?: string | null, organizationId?: string | null }) {
  const clause = owner.organizationId
    ? eq(paymentRecipients.organizationId, owner.organizationId)
    : owner.userId ? eq(paymentRecipients.userId, owner.userId) : sql`false`
  const [recipient] = await useDatabase().select().from(paymentRecipients)
    .where(and(clause, eq(paymentRecipients.status, 'active'))).limit(1)
  return recipient ?? null
}

export async function requirePaymentRecipient(
  owner: { userId?: string | null, organizationId?: string | null },
  paymentEnabled: boolean
) {
  if (!paymentEnabled) return null
  const recipient = await readyPaymentRecipient(owner)
  if (!recipient?.bachsAccountId) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Finish payout setup before turning on paid bookings.'
    })
  }
  return recipient
}

export async function createPaymentRecord(input: {
  bookingId: string
  recipientId: string
  amountCents: number
  currency: 'USD' | 'NGN'
  reference: string
}, executor: PaymentExecutor) {
  const [payment] = await executor.insert(bookingPayments).values({
    bookingId: input.bookingId,
    recipientId: input.recipientId,
    amountCents: input.amountCents,
    currency: input.currency,
    platformFeeCents: platformFeeCents(input.amountCents),
    reference: input.reference
  }).returning()
  if (!payment) throw new Error('Payment reservation could not be created.')
  return payment
}

export async function paymentForBooking(bookingId: string, executor: PaymentExecutor = useDatabase()) {
  const [payment] = await executor.select().from(bookingPayments)
    .where(eq(bookingPayments.bookingId, bookingId)).limit(1)
  return payment ?? null
}

export async function movePaidBookingPayment(previousBookingId: string, nextBookingId: string, executor: PaymentExecutor) {
  const [moved] = await executor.update(bookingPayments).set({
    bookingId: nextBookingId,
    updatedAt: new Date()
  }).where(and(
    eq(bookingPayments.bookingId, previousBookingId),
    eq(bookingPayments.status, 'paid')
  )).returning({ id: bookingPayments.id })
  return Boolean(moved)
}

export async function openPaidBookingCheckout(uid: string) {
  const booking = await findBookingByUid(uid)
  if (!booking || booking.status !== 'awaiting_payment') {
    throw createError({ statusCode: 409, statusMessage: 'This payment hold is no longer active.' })
  }
  const [payment] = await useDatabase().select({
    id: bookingPayments.id,
    reference: bookingPayments.reference,
    amountCents: bookingPayments.amountCents,
    currency: bookingPayments.currency,
    platformFeeCents: bookingPayments.platformFeeCents,
    recipientAccountId: paymentRecipients.bachsAccountId,
    recipientStatus: paymentRecipients.status
  }).from(bookingPayments)
    .innerJoin(paymentRecipients, eq(paymentRecipients.id, bookingPayments.recipientId))
    .where(eq(bookingPayments.bookingId, booking.id)).limit(1)
  if (!payment?.recipientAccountId || payment.recipientStatus !== 'active') {
    await cancelUnpaidBooking(booking.id, 'The host payment account is not ready.')
    throw createError({ statusCode: 409, statusMessage: 'This host cannot accept payments right now.' })
  }

  try {
    const base = useEnv().schedraUrl
    const session = await createCheckoutSession({
      amount: toDecimalString(payment.amountCents),
      currency: payment.currency,
      reference: payment.reference,
      customer: { email: booking.attendeeEmail, name: booking.attendeeName },
      successUrl: `${base}/booking/${encodeURIComponent(uid)}?payment=success`,
      cancelUrl: `${base}/booking/${encodeURIComponent(uid)}?payment=cancelled`,
      metadata: { schedra_booking_uid: uid, schedra_payment_reference: payment.reference },
      platformFee: toDecimalString(payment.platformFeeCents),
      destinationAccountId: payment.recipientAccountId,
      expiresInMinutes: 60
    })
    const expiresAt = session.expires_at ? new Date(session.expires_at) : new Date(Date.now() + 60 * 60_000)
    await useDatabase().update(bookingPayments).set({
      bachsCheckoutId: session.checkout_id,
      checkoutUrl: session.checkout_url,
      checkoutExpiresAt: expiresAt,
      lastError: null,
      updatedAt: new Date()
    }).where(eq(bookingPayments.id, payment.id))
    return { checkoutUrl: session.checkout_url, expiresAt: expiresAt.toISOString() }
  } catch (error) {
    await useDatabase().update(bookingPayments).set({
      status: 'failed',
      lastError: error instanceof Error ? error.message.slice(0, 1000) : 'Checkout creation failed.',
      updatedAt: new Date()
    }).where(eq(bookingPayments.id, payment.id))
    await cancelUnpaidBooking(booking.id, 'Payment checkout could not be started.')
    throw createError({
      statusCode: 503,
      statusMessage: 'Secure checkout is temporarily unavailable. Please try again shortly.',
      cause: error
    })
  }
}

async function cancelUnpaidBooking(bookingId: string, reason: string) {
  await useDatabase().update(bookings).set({
    status: 'cancelled',
    cancellationReason: reason,
    updatedAt: new Date()
  }).where(and(eq(bookings.id, bookingId), eq(bookings.status, 'awaiting_payment')))
}

export async function completePaidBooking(input: {
  checkoutId: string
  chargeId?: string | null
  amount?: string | null
  currency?: string | null
  paymentStatus?: string | null
}) {
  const [payment] = await useDatabase().select().from(bookingPayments)
    .where(eq(bookingPayments.bachsCheckoutId, input.checkoutId)).limit(1)
  if (!payment) return { matched: false, applied: false }
  if (payment.status === 'paid') return { matched: true, applied: false, reason: 'already-paid' }
  if (['refund_pending', 'refunded'].includes(payment.status)) {
    return { matched: true, applied: false, reason: payment.status }
  }
  if (input.paymentStatus && !['paid', 'succeeded', 'accepted'].includes(input.paymentStatus.toLowerCase())) {
    return { matched: true, applied: false, reason: 'not-paid' }
  }
  if (input.amount && Math.round(Number.parseFloat(input.amount) * 100) !== payment.amountCents) {
    throw new Error('Paid booking amount did not match its immutable price snapshot.')
  }
  if (input.currency && input.currency.toUpperCase() !== payment.currency) {
    throw new Error('Paid booking currency did not match its immutable price snapshot.')
  }

  const [currentBooking] = await useDatabase().select({ status: bookings.status })
    .from(bookings).where(eq(bookings.id, payment.bookingId)).limit(1)
  if (!currentBooking) throw new Error('The paid booking no longer exists.')

  // A guest can close checkout or cancel the hold while the provider is still
  // settling. Never resurrect that slot: record the verified money, then use
  // the normal idempotent refund path.
  if (currentBooking.status === 'cancelled' || ['failed', 'expired'].includes(payment.status)) {
    if (!input.chargeId) throw new Error('A late paid booking did not include a refundable charge id.')
    await useDatabase().update(bookingPayments).set({
      status: 'paid',
      bachsChargeId: input.chargeId,
      paidAt: new Date(),
      lastError: null,
      updatedAt: new Date()
    }).where(eq(bookingPayments.id, payment.id))
    await requestPaidBookingRefund(payment.bookingId, 'The booking hold was cancelled before payment settled.')
    return { matched: true, applied: true, reason: 'late-payment-refund-started' }
  }

  const managed = await findBookingByUid((await useDatabase().select({ uid: bookings.uid })
    .from(bookings).where(eq(bookings.id, payment.bookingId)).limit(1))[0]?.uid ?? '')
  const hosts = managed ? await assignedHostsForBooking(managed.id) : []

  const applied = await useDatabase().transaction(async (tx) => {
    const [updated] = await tx.update(bookingPayments).set({
      status: 'paid',
      bachsChargeId: input.chargeId ?? payment.bachsChargeId,
      paidAt: new Date(),
      lastError: null,
      updatedAt: new Date()
    }).where(and(
      eq(bookingPayments.id, payment.id),
      eq(bookingPayments.status, 'pending')
    )).returning({ bookingId: bookingPayments.bookingId })
    if (!updated) return false

    const [confirmed] = await tx.update(bookings).set({
      status: 'confirmed',
      updatedAt: new Date()
    }).where(and(
      eq(bookings.id, updated.bookingId),
      eq(bookings.status, 'awaiting_payment')
    )).returning({ id: bookings.id, eventTypeId: bookings.eventTypeId, organizationId: bookings.organizationId, hostId: bookings.hostId })
    if (!confirmed) throw new Error('The paid booking hold is no longer available.')

    await enqueueCalendarSync(confirmed.id, 'upsert', tx)
    await publishBookingEvent({
      type: 'booking_created',
      ...(confirmed.organizationId ? { organizationId: confirmed.organizationId } : { userId: confirmed.hostId }),
      bookingId: confirmed.id,
      eventTypeId: confirmed.eventTypeId,
      payload: { paid: true }
    }, tx)
    if (managed) {
      await queueBookingEmails(bookingNoticeFromManaged({ ...managed, status: 'confirmed' }, hosts), tx)
    }
    return true
  })
  return { matched: true, applied }
}

export async function failPaidBooking(checkoutId: string, reason: string) {
  const [payment] = await useDatabase().update(bookingPayments).set({
    status: reason.includes('expired') ? 'expired' : 'failed',
    lastError: reason,
    updatedAt: new Date()
  }).where(and(
    eq(bookingPayments.bachsCheckoutId, checkoutId),
    eq(bookingPayments.status, 'pending')
  )).returning({ bookingId: bookingPayments.bookingId })
  if (!payment) return false
  await cancelUnpaidBooking(payment.bookingId, 'Payment was not completed before the hold expired.')
  return true
}

export async function expirePaidBookingHolds() {
  const expired = await useDatabase().update(bookingPayments).set({
    status: 'expired',
    lastError: 'Checkout expired before payment completed.',
    updatedAt: new Date()
  }).where(and(
    eq(bookingPayments.status, 'pending'),
    lte(bookingPayments.checkoutExpiresAt, new Date())
  )).returning({ bookingId: bookingPayments.bookingId })
  if (expired.length) {
    await useDatabase().update(bookings).set({
      status: 'cancelled',
      cancellationReason: 'Payment was not completed before the hold expired.',
      updatedAt: new Date()
    }).where(and(
      inArray(bookings.id, expired.map(row => row.bookingId)),
      eq(bookings.status, 'awaiting_payment')
    ))
  }
  return expired.length
}

export async function requestPaidBookingRefund(bookingId: string, reason: string) {
  const payment = await paymentForBooking(bookingId)
  if (!payment || !['paid', 'refund_failed'].includes(payment.status)) return { required: false as const }
  if (!payment.bachsChargeId) throw createError({ statusCode: 409, statusMessage: 'This payment is still settling. Try cancelling again shortly.' })
  const reference = `booking-refund-${payment.id}`
  const [claimed] = await useDatabase().update(bookingPayments).set({
    status: 'refund_pending',
    lastError: null,
    updatedAt: new Date()
  }).where(and(
    eq(bookingPayments.id, payment.id),
    inArray(bookingPayments.status, ['paid', 'refund_failed'])
  )).returning({ id: bookingPayments.id })
  if (!claimed) return { required: true as const }
  try {
    await createRefund({ chargeId: payment.bachsChargeId, reference, reason })
  } catch (error) {
    await useDatabase().update(bookingPayments).set({
      status: 'refund_failed',
      lastError: error instanceof Error ? error.message.slice(0, 1000) : 'Refund request failed.',
      updatedAt: new Date()
    }).where(eq(bookingPayments.id, payment.id))
    throw error
  }
  return { required: true as const }
}

export async function applyRefundEvent(input: { reference?: string | null, status: 'paid' | 'failed' }) {
  if (!input.reference?.startsWith('booking-refund-')) return false
  const id = input.reference.slice('booking-refund-'.length)
  const [updated] = await useDatabase().update(bookingPayments).set({
    status: input.status === 'paid' ? 'refunded' : 'refund_failed',
    refundedAt: input.status === 'paid' ? new Date() : null,
    lastError: input.status === 'failed' ? 'Bachs could not complete the refund.' : null,
    updatedAt: new Date()
  }).where(eq(bookingPayments.id, id)).returning({ id: bookingPayments.id })
  return Boolean(updated)
}

export async function eventPaymentReadiness(eventTypeId: string) {
  const [eventType] = await useDatabase().select({
    userId: eventTypes.userId,
    organizationId: eventTypes.organizationId,
    paymentEnabled: eventTypes.paymentEnabled,
    priceCents: eventTypes.priceCents,
    paymentCurrency: eventTypes.paymentCurrency
  }).from(eventTypes).where(eq(eventTypes.id, eventTypeId)).limit(1)
  if (!eventType?.paymentEnabled || !eventType.priceCents) return null
  const recipient = await readyPaymentRecipient(eventType)
  if (!recipient?.bachsAccountId) {
    throw createError({ statusCode: 409, statusMessage: 'The host must finish payment setup before this paid event can accept bookings.' })
  }
  return {
    recipient,
    amountCents: eventType.priceCents,
    currency: eventType.paymentCurrency as 'USD' | 'NGN'
  }
}
