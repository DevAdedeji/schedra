import { and, eq, inArray, lte } from 'drizzle-orm'
import type { Database } from '../database/client'
import {
  bookingPayments,
  bookings,
  eventTypes,
  paymentRecipients
} from '../database/schema'
import { useDatabase } from '../database'
import {
  createCheckoutSession,
  createRefund,
  getCheckoutSession,
  type BachsCheckoutSession
} from '../integrations/bachs'
import { toDecimalString } from '#shared/billing'
import { useEnv } from '../config/env'
import { assignedHostsForBooking, findBookingByUid } from '../repositories/booking'
import { appendPaymentLedgerEntry } from '../repositories/payment-ledger'
import { bookingNoticeFromManaged, queueBookingEmails } from './booking-emails'
import { enqueueCalendarSync } from './calendar-sync'
import { publishBookingEvent } from './workflows'
import { logEvent } from '../observability/logger'
import {
  findPaymentRecipient,
  syncPaymentRecipient,
  type PaymentRecipientOwner
} from './payment-recipient'

type PaymentExecutor = Pick<Database, 'insert' | 'select' | 'update'>

export const PAYMENT_HOLD_EXPIRED_REASON = 'Payment was not completed before the hold expired.'
const SLOT_TAKEN = '23P01'

function paymentRecipientOwner(owner: { userId?: string | null, organizationId?: string | null }): PaymentRecipientOwner | null {
  return owner.organizationId
    ? { organizationId: owner.organizationId }
    : owner.userId ? { userId: owner.userId } : null
}

async function currentPaymentRecipient(owner: { userId?: string | null, organizationId?: string | null }) {
  const normalized = paymentRecipientOwner(owner)
  if (!normalized) return null
  const stored = await findPaymentRecipient(normalized)
  if (!stored?.bachsAccountId) return stored

  // Local status is only a cache. Re-check Bachs at every money-sensitive
  // boundary so an incomplete, reviewed or restricted account cannot accept
  // money based on yesterday's provider state.
  return syncPaymentRecipient(stored)
}

export function platformFeeCents(amountCents: number) {
  const fee = Math.round(amountCents * useEnv().paidBookingPlatformFeeBps / 10_000)
  return Math.min(amountCents - 1, Math.max(1, fee))
}

export async function readyPaymentRecipient(owner: { userId?: string | null, organizationId?: string | null }) {
  const current = await currentPaymentRecipient(owner)
  return current?.status === 'active' ? current : null
}

export async function requirePaymentRecipient(
  owner: { userId?: string | null, organizationId?: string | null },
  paymentEnabled: boolean
) {
  if (!paymentEnabled) return null
  const recipient = await currentPaymentRecipient(owner)
  if (!recipient?.bachsAccountId || recipient.status !== 'active') {
    const statusMessage = recipient?.status === 'pending_review'
      ? 'Bachs is still reviewing this payout account. Paid bookings can be enabled after transfers and payouts are approved.'
      : recipient?.status === 'restricted'
        ? 'Bachs needs more information for this payout account. Resolve the restriction before enabling paid bookings.'
        : recipient?.status === 'disabled'
          ? 'This payout account is disabled. Contact support before enabling paid bookings.'
          : 'Complete payout setup in Bachs before turning on paid bookings.'
    throw createError({
      statusCode: 409,
      statusMessage
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
  await appendPaymentLedgerEntry({
    bookingPaymentId: payment.id,
    dedupeKey: `payment:${payment.id}:created`,
    kind: 'checkout',
    direction: 'none',
    status: 'pending',
    amountCents: payment.amountCents,
    currency: payment.currency as 'USD' | 'NGN',
    message: 'Payment reservation created.',
    metadata: { platformFeeCents: payment.platformFeeCents }
  }, executor)
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
    recipientId: paymentRecipients.id,
    recipientAccountId: paymentRecipients.bachsAccountId
  }).from(bookingPayments)
    .innerJoin(paymentRecipients, eq(paymentRecipients.id, bookingPayments.recipientId))
    .where(eq(bookingPayments.bookingId, booking.id)).limit(1)
  if (!payment?.recipientAccountId) {
    await cancelUnpaidBooking(booking.id, 'The host payment account is not ready.')
    throw createError({ statusCode: 409, statusMessage: 'This host cannot accept payments right now.' })
  }

  const [storedRecipient] = await useDatabase().select().from(paymentRecipients)
    .where(eq(paymentRecipients.id, payment.recipientId)).limit(1)
  const currentRecipient = storedRecipient?.bachsAccountId
    ? await syncPaymentRecipient(storedRecipient)
    : null
  if (!currentRecipient || currentRecipient.status !== 'active') {
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
      // Bachs appends `?checkout_id=...` after payment. Keep this URL free of
      // its own query string so the return marker is always parsed correctly.
      successUrl: `${base}/booking/${encodeURIComponent(uid)}`,
      cancelUrl: `${base}/booking/${encodeURIComponent(uid)}?payment=cancelled`,
      metadata: { schedra_booking_uid: uid, schedra_payment_reference: payment.reference },
      platformFee: toDecimalString(payment.platformFeeCents),
      destinationAccountId: currentRecipient.bachsAccountId!,
      expiresInMinutes: 60
    })
    const expiresAt = session.expires_at ? new Date(session.expires_at) : new Date(Date.now() + 60 * 60_000)
    await useDatabase().transaction(async (tx) => {
      await tx.update(bookingPayments).set({
        bachsCheckoutId: session.checkout_id,
        checkoutUrl: session.checkout_url,
        checkoutExpiresAt: expiresAt,
        lastError: null,
        updatedAt: new Date()
      }).where(eq(bookingPayments.id, payment.id))
      await appendPaymentLedgerEntry({
        bookingPaymentId: payment.id,
        dedupeKey: `payment:${payment.id}:checkout:${session.checkout_id}`,
        kind: 'checkout',
        direction: 'none',
        status: 'pending',
        amountCents: payment.amountCents,
        currency: payment.currency as 'USD' | 'NGN',
        providerObjectId: session.checkout_id,
        message: 'Secure checkout opened.',
        metadata: { expiresAt: expiresAt.toISOString() }
      }, tx)
    })
    return { checkoutUrl: session.checkout_url, expiresAt: expiresAt.toISOString() }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : 'Checkout creation failed.'
    await useDatabase().transaction(async (tx) => {
      await tx.update(bookingPayments).set({
        status: 'failed',
        lastError: message,
        updatedAt: new Date()
      }).where(eq(bookingPayments.id, payment.id))
      await appendPaymentLedgerEntry({
        bookingPaymentId: payment.id,
        dedupeKey: `payment:${payment.id}:checkout-failed`,
        kind: 'checkout',
        direction: 'none',
        status: 'failed',
        amountCents: payment.amountCents,
        currency: payment.currency as 'USD' | 'NGN',
        message
      }, tx)
    })
    await cancelUnpaidBooking(booking.id, 'Payment checkout could not be started.')
    throw createError({
      statusCode: 503,
      statusMessage: 'Secure checkout is temporarily unavailable. Please try again shortly.',
      cause: error
    })
  }
}

type CheckoutPaymentState = 'paid' | 'pending' | 'failed'

/**
 * A browser redirect is never payment proof. This classification is only used
 * after Schedra has fetched the checkout directly from Bachs with its secret
 * key. A successful charge is authoritative even if the checkout lifecycle
 * briefly lags behind it.
 */
export function checkoutPaymentState(session: BachsCheckoutSession): CheckoutPaymentState {
  const paymentStatus = session.charge?.status ?? session.payment_status
  // A provider-confirmed charge is the money source of truth. Checkout state
  // can lag behind the charge around expiry, so requiring both to become
  // terminal can turn a real payment into a false expiry.
  if (session.charge && ['succeeded', 'accepted'].includes(session.charge.status)) return 'paid'
  if (
    session.status === 'completed'
    && (paymentStatus === 'succeeded' || paymentStatus === 'accepted')
  ) return 'paid'

  if (
    session.status === 'expired'
    || session.status === 'cancelled'
    || ['failed', 'canceled', 'cancelled', 'expired'].includes(paymentStatus ?? '')
  ) return 'failed'

  return 'pending'
}

/**
 * Provider-backed fallback for a delayed or missed webhook. The booking UID
 * locates the immutable local payment, while the stored checkout id is the
 * only id sent to Bachs. The query string returned by checkout is deliberately
 * ignored.
 */
export async function reconcilePaidBooking(uid: string) {
  const booking = await findBookingByUid(uid)
  if (!booking) throw createError({ statusCode: 404, statusMessage: 'No such booking' })

  const payment = await paymentForBooking(booking.id)
  if (!payment) throw createError({ statusCode: 409, statusMessage: 'This booking does not require payment.' })
  if (payment.status === 'paid' && booking.status === 'confirmed') {
    return { status: 'confirmed' as const }
  }
  if (!payment.bachsCheckoutId) {
    throw createError({ statusCode: 409, statusMessage: 'Secure checkout has not started yet.' })
  }

  const checkout = await getCheckoutSession(payment.bachsCheckoutId)
  if (checkout.checkout_id !== payment.bachsCheckoutId) {
    throw new Error('Bachs returned a different checkout than the one requested.')
  }
  if (checkout.reference && checkout.reference !== payment.reference) {
    throw new Error('Bachs checkout reference did not match this booking.')
  }

  const providerState = checkoutPaymentState(checkout)
  if (providerState === 'paid') {
    const result = await completePaidBookingFromCheckout(checkout)
    if (!result.matched) throw new Error('The verified checkout is not attached to a booking payment.')
    const refreshed = await findBookingByUid(uid)
    if (refreshed?.status === 'confirmed') return { status: 'confirmed' as const }
    if (result.reason === 'late-payment-refund-started') return { status: 'refund_pending' as const }
    throw createError({
      statusCode: 409,
      statusMessage: 'Payment was confirmed, but this booking could not be restored. Please contact support.'
    })
  }

  if (providerState === 'failed') {
    const reason = checkout.status === 'expired'
      ? 'checkout.expired'
      : checkout.status === 'cancelled' ? 'checkout.cancelled' : 'checkout.failed'
    await failPaidBooking(checkout.checkout_id, reason)
    return { status: checkout.status === 'expired' ? 'expired' as const : 'failed' as const }
  }

  return { status: 'pending' as const }
}

export function completePaidBookingFromCheckout(
  checkout: BachsCheckoutSession,
  context: {
    providerEventId?: string | null
    amountCollectedCents?: number | null
    amountCollectedCurrency?: string | null
  } = {}
) {
  if (checkoutPaymentState(checkout) !== 'paid') {
    return Promise.resolve({ matched: false, applied: false, reason: 'not-paid' as const })
  }
  return completePaidBooking({
    checkoutId: checkout.checkout_id,
    chargeId: checkout.charge?.payment_id,
    reference: checkout.reference,
    amount: checkout.amount,
    amountPaidCents: toCents(checkout.charge?.amount_paid),
    amountPaidCurrency: checkout.charge?.currency,
    amountCollectedCents: context.amountCollectedCents,
    amountCollectedCurrency: context.amountCollectedCurrency,
    providerFeeCents: toCents(checkout.charge?.fee_usd),
    providerFeeCurrency: checkout.charge?.fee_usd ? 'USD' : null,
    paymentMethod: checkout.payment_method,
    currency: checkout.currency,
    paymentStatus: checkout.charge?.status ?? checkout.payment_status,
    providerEventId: context.providerEventId
  })
}

function toCents(amount?: string | null) {
  if (!amount) return null
  const parsed = Number.parseFloat(amount)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null
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
  reference?: string | null
  amount?: string | null
  amountPaidCents?: number | null
  amountPaidCurrency?: string | null
  amountCollectedCents?: number | null
  amountCollectedCurrency?: string | null
  providerFeeCents?: number | null
  providerFeeCurrency?: string | null
  paymentMethod?: string | null
  currency?: string | null
  paymentStatus?: string | null
  providerEventId?: string | null
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
  if (input.reference && input.reference !== payment.reference) {
    throw new Error('Paid booking reference did not match its immutable payment reference.')
  }
  if (input.amount && Math.round(Number.parseFloat(input.amount) * 100) !== payment.amountCents) {
    throw new Error('Paid booking amount did not match its immutable price snapshot.')
  }
  if (input.currency && input.currency.toUpperCase() !== payment.currency) {
    throw new Error('Paid booking currency did not match its immutable price snapshot.')
  }

  const [currentBooking] = await useDatabase().select({
    status: bookings.status,
    cancellationReason: bookings.cancellationReason
  })
    .from(bookings).where(eq(bookings.id, payment.bookingId)).limit(1)
  if (!currentBooking) throw new Error('The paid booking no longer exists.')

  const managed = await findBookingByUid((await useDatabase().select({ uid: bookings.uid })
    .from(bookings).where(eq(bookings.id, payment.bookingId)).limit(1))[0]?.uid ?? '')
  const hosts = managed ? await assignedHostsForBooking(managed.id) : []

  // If our expiry sweep won the race against a successful charge, put the
  // booking back when its original slot is still available. The reservation
  // trigger makes this atomic and rejects the update if another booking has
  // genuinely claimed the time meanwhile.
  if (
    currentBooking.status === 'cancelled'
    && currentBooking.cancellationReason === PAYMENT_HOLD_EXPIRED_REASON
    && ['failed', 'expired', 'refund_failed'].includes(payment.status)
  ) {
    try {
      const restored = await useDatabase().transaction(async (tx) => {
        const [confirmed] = await tx.update(bookings).set({
          status: 'confirmed',
          cancellationReason: null,
          updatedAt: new Date()
        }).where(and(
          eq(bookings.id, payment.bookingId),
          eq(bookings.status, 'cancelled'),
          eq(bookings.cancellationReason, PAYMENT_HOLD_EXPIRED_REASON)
        )).returning({
          id: bookings.id,
          eventTypeId: bookings.eventTypeId,
          organizationId: bookings.organizationId,
          hostId: bookings.hostId
        })
        if (!confirmed) return false

        const [updated] = await tx.update(bookingPayments).set({
          status: 'paid',
          bachsChargeId: input.chargeId ?? payment.bachsChargeId,
          paidAt: payment.paidAt ?? new Date(),
          lastError: null,
          updatedAt: new Date()
        }).where(and(
          eq(bookingPayments.id, payment.id),
          inArray(bookingPayments.status, ['failed', 'expired', 'refund_failed'])
        )).returning({ id: bookingPayments.id })
        if (!updated) throw new Error('The paid booking payment changed during recovery.')

        if (!payment.paidAt) await recordSuccessfulPaymentEntries(payment, input, tx)

        await enqueueCalendarSync(confirmed.id, 'upsert', tx)
        await publishBookingEvent({
          type: 'booking_created',
          ...(confirmed.organizationId ? { organizationId: confirmed.organizationId } : { userId: confirmed.hostId }),
          bookingId: confirmed.id,
          eventTypeId: confirmed.eventTypeId,
          payload: { paid: true, recovered: true }
        }, tx)
        if (managed) {
          await queueBookingEmails(bookingNoticeFromManaged({ ...managed, status: 'confirmed', cancellationReason: null }, hosts), tx)
        }
        return true
      })
      if (restored) return { matched: true, applied: true, reason: 'expired-hold-restored' }
    } catch (error) {
      if (errorCode(error) !== SLOT_TAKEN) throw error
      // The slot really was claimed after expiry. Continue into the existing
      // refund path instead of double-booking the host.
    }
  }

  // A guest can close checkout or cancel the hold while the provider is still
  // settling. Never resurrect that slot: record the verified money, then use
  // the normal idempotent refund path.
  if (currentBooking.status === 'cancelled' || ['failed', 'expired'].includes(payment.status)) {
    if (!input.chargeId) throw new Error('A late paid booking did not include a refundable charge id.')
    const claimed = await useDatabase().transaction(async (tx) => {
      const [updated] = await tx.update(bookingPayments).set({
        status: 'paid',
        bachsChargeId: input.chargeId,
        paidAt: payment.paidAt ?? new Date(),
        lastError: null,
        updatedAt: new Date()
      }).where(and(
        eq(bookingPayments.id, payment.id),
        inArray(bookingPayments.status, ['pending', 'failed', 'expired', 'refund_failed'])
      )).returning({ id: bookingPayments.id })
      if (!updated) return false
      if (!payment.paidAt) await recordSuccessfulPaymentEntries(payment, input, tx)
      return true
    })
    // A webhook and browser reconciliation can race after a late charge. Only
    // the request that atomically moved the payment to `paid` may write money
    // entries or start the refund; the other observes the completed claim.
    if (!claimed) return { matched: true, applied: false, reason: 'already-paid' }
    await requestPaidBookingRefund(payment.bookingId, 'The booking hold was cancelled before payment settled.')
    return { matched: true, applied: true, reason: 'late-payment-refund-started' }
  }

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

    await recordSuccessfulPaymentEntries(payment, input, tx)

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

export async function failPaidBooking(checkoutId: string, reason: string, providerEventId?: string | null) {
  const payment = await useDatabase().transaction(async (tx) => {
    const [updated] = await tx.update(bookingPayments).set({
      status: reason.includes('expired') ? 'expired' : 'failed',
      lastError: reason,
      updatedAt: new Date()
    }).where(and(
      eq(bookingPayments.bachsCheckoutId, checkoutId),
      eq(bookingPayments.status, 'pending')
    )).returning({
      id: bookingPayments.id,
      bookingId: bookingPayments.bookingId,
      amountCents: bookingPayments.amountCents,
      currency: bookingPayments.currency
    })
    if (!updated) return null
    await appendPaymentLedgerEntry({
      bookingPaymentId: updated.id,
      dedupeKey: `payment:${updated.id}:failed:${providerEventId ?? checkoutId}`,
      kind: 'customer_payment',
      direction: 'in',
      status: reason.includes('expired') ? 'expired' : 'failed',
      amountCents: updated.amountCents,
      currency: updated.currency as 'USD' | 'NGN',
      providerEventId,
      providerObjectId: checkoutId,
      message: reason
    }, tx)
    return updated
  })
  if (!payment) return false
  await cancelUnpaidBooking(payment.bookingId, PAYMENT_HOLD_EXPIRED_REASON)
  return true
}

/**
 * Preserve provider lifecycle states that do not confirm or fail a booking.
 * These entries are operational evidence only: ambiguous states such as
 * UNDERPAID and OVERPAID never unlock a calendar slot by themselves.
 */
export async function recordPaidBookingProviderObservation(input: {
  checkoutId: string
  providerEventId?: string | null
  providerStatus?: string | null
  eventType: string
  amountPaidCents?: number | null
  amountRemainingCents?: number | null
}) {
  const [payment] = await useDatabase().select().from(bookingPayments)
    .where(eq(bookingPayments.bachsCheckoutId, input.checkoutId)).limit(1)
  if (!payment) return false
  const providerStatus = input.providerStatus?.toLowerCase() ?? 'unknown'
  const status = providerStatus === 'expired'
    ? 'expired'
    : ['failed', 'cancelled', 'underpaid'].includes(providerStatus)
        ? 'failed'
        : ['succeeded', 'accepted'].includes(providerStatus)
            ? 'succeeded'
            : 'pending'
  await appendPaymentLedgerEntry({
    bookingPaymentId: payment.id,
    dedupeKey: `payment:${payment.id}:provider-observation:${input.providerEventId ?? `${input.eventType}:${providerStatus}`}`,
    kind: 'customer_payment',
    direction: 'in',
    status,
    amountCents: input.amountPaidCents,
    currency: payment.currency as 'USD' | 'NGN',
    providerEventId: input.providerEventId,
    providerObjectId: input.checkoutId,
    message: `Bachs reported ${providerStatus === 'unknown' ? input.eventType : providerStatus}.`,
    metadata: {
      providerStatus,
      eventType: input.eventType,
      amountRemainingCents: input.amountRemainingCents ?? null
    }
  })
  return true
}

export async function expirePaidBookingHolds() {
  const candidates = await useDatabase().select({
    id: bookingPayments.id,
    checkoutId: bookingPayments.bachsCheckoutId
  }).from(bookingPayments).where(and(
    eq(bookingPayments.status, 'pending'),
    lte(bookingPayments.checkoutExpiresAt, new Date())
  ))

  let expired = 0
  for (const candidate of candidates) {
    if (!candidate.checkoutId) continue
    try {
      const checkout = await getCheckoutSession(candidate.checkoutId)
      const state = checkoutPaymentState(checkout)
      if (state === 'paid') {
        await completePaidBookingFromCheckout(checkout)
      } else if (state === 'failed') {
        const reason = checkout.status === 'expired'
          ? 'checkout.expired'
          : checkout.status === 'cancelled' ? 'checkout.cancelled' : 'checkout.failed'
        if (await failPaidBooking(candidate.checkoutId, reason)) expired += 1
      }
      // An open or processing checkout remains held. Local time alone is not
      // proof that money was not received, and Bachs will report a terminal
      // state on a later pass.
    } catch (error) {
      logEvent('warn', 'paid_booking_expiry_reconciliation_failed', {
        paymentId: candidate.id,
        checkoutId: candidate.checkoutId,
        error
      })
    }
  }
  return expired
}

function errorCode(error: unknown) {
  return typeof error === 'object' && error && 'code' in error
    ? String(error.code)
    : null
}

export async function requestPaidBookingRefund(bookingId: string, reason: string) {
  const payment = await paymentForBooking(bookingId)
  if (!payment || !['paid', 'refund_failed'].includes(payment.status)) return { required: false as const }
  if (!payment.bachsChargeId) throw createError({ statusCode: 409, statusMessage: 'This payment is still settling. Try cancelling again shortly.' })
  const reference = `booking-refund-${payment.id}`
  const claimed = await useDatabase().transaction(async (tx) => {
    const [updated] = await tx.update(bookingPayments).set({
      status: 'refund_pending',
      lastError: null,
      updatedAt: new Date()
    }).where(and(
      eq(bookingPayments.id, payment.id),
      inArray(bookingPayments.status, ['paid', 'refund_failed'])
    )).returning({
      id: bookingPayments.id,
      amountCents: bookingPayments.amountCents,
      currency: bookingPayments.currency
    })
    if (!updated) return null
    await appendPaymentLedgerEntry({
      bookingPaymentId: payment.id,
      dedupeKey: `payment:${payment.id}:refund-requested`,
      kind: 'refund',
      direction: 'out',
      status: 'pending',
      amountCents: updated.amountCents,
      currency: updated.currency as 'USD' | 'NGN',
      providerObjectId: payment.bachsChargeId,
      message: reason
    }, tx)
    return updated
  })
  if (!claimed) return { required: true as const }
  try {
    await createRefund({ chargeId: payment.bachsChargeId, reference, reason })
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : 'Refund request failed.'
    await useDatabase().transaction(async (tx) => {
      await tx.update(bookingPayments).set({
        status: 'refund_failed',
        lastError: message,
        updatedAt: new Date()
      }).where(eq(bookingPayments.id, payment.id))
      await appendPaymentLedgerEntry({
        bookingPaymentId: payment.id,
        dedupeKey: `payment:${payment.id}:refund-request-failed`,
        kind: 'refund',
        direction: 'out',
        status: 'failed',
        amountCents: payment.amountCents,
        currency: payment.currency as 'USD' | 'NGN',
        providerObjectId: payment.bachsChargeId,
        message
      }, tx)
    })
    throw error
  }
  return { required: true as const }
}

export async function applyRefundEvent(input: {
  reference?: string | null
  status: 'paid' | 'failed'
  providerEventId?: string | null
  refundId?: string | null
}) {
  if (!input.reference?.startsWith('booking-refund-')) return false
  const id = input.reference.slice('booking-refund-'.length)
  const updated = await useDatabase().transaction(async (tx) => {
    const [payment] = await tx.update(bookingPayments).set({
      status: input.status === 'paid' ? 'refunded' : 'refund_failed',
      refundedAt: input.status === 'paid' ? new Date() : null,
      lastError: input.status === 'failed' ? 'Bachs could not complete the refund.' : null,
      updatedAt: new Date()
    }).where(eq(bookingPayments.id, id)).returning({
      id: bookingPayments.id,
      amountCents: bookingPayments.amountCents,
      currency: bookingPayments.currency,
      chargeId: bookingPayments.bachsChargeId
    })
    if (!payment) return null
    await appendPaymentLedgerEntry({
      bookingPaymentId: payment.id,
      dedupeKey: `payment:${payment.id}:refund:${input.providerEventId ?? input.status}`,
      kind: 'refund',
      direction: 'out',
      status: input.status === 'paid' ? 'succeeded' : 'failed',
      amountCents: payment.amountCents,
      currency: payment.currency as 'USD' | 'NGN',
      providerEventId: input.providerEventId,
      providerObjectId: input.refundId ?? payment.chargeId,
      message: input.status === 'paid' ? 'Refund completed.' : 'Bachs could not complete the refund.'
    }, tx)
    return payment
  })
  return Boolean(updated)
}

async function recordSuccessfulPaymentEntries(
  payment: typeof bookingPayments.$inferSelect,
  input: {
    checkoutId: string
    chargeId?: string | null
    amountPaidCents?: number | null
    amountPaidCurrency?: string | null
    amountCollectedCents?: number | null
    amountCollectedCurrency?: string | null
    providerFeeCents?: number | null
    providerFeeCurrency?: string | null
    paymentMethod?: string | null
    providerEventId?: string | null
  },
  executor: PaymentExecutor
) {
  const objectId = input.chargeId ?? input.checkoutId
  // Provider events are delivery attempts around the same charge. Use the
  // charge (or checkout fallback) as the financial identity so webhook and
  // browser recovery paths converge on one ledger entry.
  const suffix = objectId
  const metadata = {
    platformFeeCents: payment.platformFeeCents,
    amountPaidCents: input.amountPaidCents ?? null,
    amountPaidCurrency: normalCurrency(input.amountPaidCurrency),
    amountCollectedCents: input.amountCollectedCents ?? null,
    amountCollectedCurrency: normalCurrency(input.amountCollectedCurrency),
    providerFeeCents: input.providerFeeCents ?? null,
    paymentMethod: input.paymentMethod ?? null
  }
  await appendPaymentLedgerEntry({
    bookingPaymentId: payment.id,
    dedupeKey: `payment:${payment.id}:customer-payment:${suffix}`,
    kind: 'customer_payment',
    direction: 'in',
    status: 'succeeded',
    // This is the immutable event price. Bachs may collect that price through
    // a local-currency rail, but the tender value must not replace what the
    // guest purchased (for example, ₦7,391.13 must not become $7,391.13).
    amountCents: payment.amountCents,
    currency: payment.currency as 'USD' | 'NGN',
    providerEventId: input.providerEventId,
    providerObjectId: objectId,
    message: 'Customer payment confirmed.',
    metadata
  }, executor)
  await appendPaymentLedgerEntry({
    bookingPaymentId: payment.id,
    dedupeKey: `payment:${payment.id}:platform-fee:${suffix}`,
    kind: 'platform_fee',
    direction: 'out',
    status: 'succeeded',
    amountCents: payment.platformFeeCents,
    currency: payment.currency as 'USD' | 'NGN',
    providerEventId: input.providerEventId,
    providerObjectId: objectId,
    message: 'Schedra platform fee recorded.'
  }, executor)
  if (input.providerFeeCents != null) {
    await appendPaymentLedgerEntry({
      bookingPaymentId: payment.id,
      dedupeKey: `payment:${payment.id}:processing-fee:${suffix}`,
      kind: 'processing_fee',
      direction: 'out',
      status: 'succeeded',
      amountCents: input.providerFeeCents,
      currency: normalCurrency(input.providerFeeCurrency) ?? 'USD',
      providerEventId: input.providerEventId,
      providerObjectId: objectId,
      message: 'Bachs processing fee reported by the provider.'
    }, executor)
  }
  const settlementCurrency = normalCurrency(input.amountCollectedCurrency)
  if (input.amountCollectedCents != null && settlementCurrency) {
    await appendPaymentLedgerEntry({
      bookingPaymentId: payment.id,
      dedupeKey: `payment:${payment.id}:settlement:${suffix}`,
      kind: 'settlement',
      direction: 'in',
      status: 'succeeded',
      amountCents: input.amountCollectedCents,
      currency: settlementCurrency,
      providerEventId: input.providerEventId,
      providerObjectId: objectId,
      message: 'Bachs reported the settled amount after fees.'
    }, executor)
  }
}

function normalCurrency(currency?: string | null): 'USD' | 'NGN' | null {
  const value = currency?.toUpperCase()
  return value === 'USD' || value === 'NGN' ? value : null
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
    throw createError({
      statusCode: 409,
      statusMessage: 'This paid event is temporarily unavailable while the host’s payout account is verified. No payment has been taken.'
    })
  }
  return {
    recipient,
    amountCents: eventType.priceCents,
    currency: eventType.paymentCurrency as 'USD' | 'NGN'
  }
}
