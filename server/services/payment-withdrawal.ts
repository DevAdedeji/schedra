import { createHmac, timingSafeEqual } from 'node:crypto'
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import type { PaymentCurrency, WithdrawalCreateInput, WithdrawalPreviewInput } from '#shared/payments'
import { fromDecimalString, toDecimalString } from '#shared/billing'
import { paymentRecipients, paymentWithdrawals } from '../database/schema'
import { useDatabase } from '../database'
import { useEnv } from '../config/env'
import {
  createConnectedAccountPayout,
  createConnectedAccountPayoutQuote,
  estimateConnectedAccountPayout,
  getConnectedAccountBalance,
  getConnectedAccountPayout,
  listConnectedAccountPayoutDestinations,
  listConnectedAccountPayouts,
  type BachsPayout,
  type BachsPayoutDestination,
  type BachsPayoutEstimate
} from '../integrations/bachs'
import { logEvent } from '../observability/logger'
import {
  findPaymentRecipient,
  syncPaymentRecipient,
  type PaymentRecipientOwner
} from './payment-recipient'

const PREVIEW_VERSION = 1
const PREVIEW_LIFETIME_MS = 5 * 60 * 1000
const PROVIDER_EXPIRY_SAFETY_MS = 10_000
const NON_TERMINAL_STATUSES = ['creating', 'pending', 'processing', 'unknown'] as const

interface ConfirmationPayload {
  v: typeof PREVIEW_VERSION
  recipientId: string
  destinationId: string
  destinationName: string
  sourceCurrency: PaymentCurrency
  destinationCurrency: PaymentCurrency
  requestedAmountCents: number
  deliveredAmountCents: number
  feeCents: number | null
  totalDebitedCents: number
  exchangeRate: string | null
  quoteId: string | null
  expiresAt: number
}

function supportedCurrency(value?: string | null): PaymentCurrency | null {
  const normalized = value?.toUpperCase()
  return normalized === 'USD' || normalized === 'NGN' ? normalized : null
}

function providerCents(value?: string | null) {
  return fromDecimalString(value)
}

function requiredProviderCents(value: string | null | undefined, field: string) {
  const cents = providerCents(value)
  if (cents <= 0) {
    throw createError({ statusCode: 502, statusMessage: `Bachs returned an invalid ${field}. No money was moved.` })
  }
  return cents
}

function payoutMethod(destination: BachsPayoutDestination): BachsPayoutEstimate['payout_method'] {
  if (destination.type === 'bank_account') return 'BANK_TRANSFER'
  if (destination.type === 'mobile_money') return 'MOBILE_MONEY'
  return 'CRYPTO'
}

function publicDestination(destination: BachsPayoutDestination) {
  return {
    id: destination.id,
    name: destination.name,
    type: destination.type,
    currency: supportedCurrency(destination.currency)!,
    isDefault: destination.is_default
  }
}

function publicWithdrawal(row: typeof paymentWithdrawals.$inferSelect) {
  return {
    id: row.id,
    status: row.status as 'creating' | 'pending' | 'processing' | 'completed' | 'failed' | 'unknown',
    destinationName: row.destinationName,
    sourceCurrency: row.sourceCurrency as PaymentCurrency,
    destinationCurrency: row.destinationCurrency as PaymentCurrency,
    requestedAmountCents: row.requestedAmountCents,
    deliveredAmountCents: row.deliveredAmountCents,
    feeCents: row.feeCents,
    totalDebitedCents: row.totalDebitedCents,
    failureReason: row.failureReason,
    providerPayoutId: row.bachsPayoutId,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null
  }
}

function previewSignature(encoded: string) {
  return createHmac('sha256', useEnv().authSecret)
    .update(`schedra-withdrawal-preview-v${PREVIEW_VERSION}.${encoded}`)
    .digest('base64url')
}

function createConfirmationToken(payload: ConfirmationPayload) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${encoded}.${previewSignature(encoded)}`
}

function readConfirmationToken(token: string): ConfirmationPayload {
  const [encoded, signature, extra] = token.split('.')
  if (!encoded || !signature || extra) throw invalidPreview()
  const expected = Buffer.from(previewSignature(encoded))
  const received = Buffer.from(signature)
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw invalidPreview()

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ConfirmationPayload
    if (
      payload.v !== PREVIEW_VERSION
      || !payload.recipientId
      || !payload.destinationId
      || !payload.destinationName
      || !supportedCurrency(payload.sourceCurrency)
      || !supportedCurrency(payload.destinationCurrency)
      || !Number.isInteger(payload.requestedAmountCents)
      || payload.requestedAmountCents <= 0
      || !Number.isInteger(payload.deliveredAmountCents)
      || payload.deliveredAmountCents <= 0
      || !Number.isInteger(payload.totalDebitedCents)
      || payload.totalDebitedCents <= 0
      || (payload.feeCents !== null && (!Number.isInteger(payload.feeCents) || payload.feeCents < 0))
      || !Number.isFinite(payload.expiresAt)
    ) throw invalidPreview()
    if (payload.expiresAt <= Date.now()) {
      throw createError({ statusCode: 409, statusMessage: 'This withdrawal preview has expired. Review the latest rate and fee before trying again.' })
    }
    return payload
  } catch (error) {
    if (isHttpError(error)) throw error
    throw invalidPreview()
  }
}

function invalidPreview() {
  return createError({ statusCode: 400, statusMessage: 'This withdrawal confirmation is invalid. Request a new preview.' })
}

function isHttpError(error: unknown): error is { statusCode: number, statusMessage?: string, data?: { errorCode?: string } } {
  return Boolean(error && typeof error === 'object' && 'statusCode' in error)
}

async function readyRecipient(owner: PaymentRecipientOwner) {
  const current = await findPaymentRecipient(owner)
  if (!current?.bachsAccountId) {
    throw createError({ statusCode: 409, statusMessage: 'Complete payout account setup before withdrawing funds.' })
  }
  let recipient: NonNullable<typeof current>
  try {
    recipient = await syncPaymentRecipient(current)
  } catch {
    throw createError({ statusCode: 503, statusMessage: 'Schedra could not verify your payout account with Bachs. No money was moved.' })
  }
  if (recipient.status !== 'active') {
    throw createError({
      statusCode: 409,
      statusMessage: recipient.status === 'pending_review'
        ? 'Bachs is still reviewing this payout account.'
        : 'This payout account is not ready for withdrawals.'
    })
  }
  const accountId = recipient.bachsAccountId
  if (!accountId) {
    throw createError({ statusCode: 409, statusMessage: 'Complete payout account setup before withdrawing funds.' })
  }
  return { recipient, accountId }
}

async function approvedDestinations(accountId: string) {
  const destinations = await listConnectedAccountPayoutDestinations(accountId)
  return destinations.filter(destination =>
    destination.status === 'approved'
    && destination.is_usable === true
    && supportedCurrency(destination.currency)
  )
}

async function availableBalanceCents(accountId: string, currency: PaymentCurrency) {
  const balance = await getConnectedAccountBalance(accountId)
  const bucket = balance.balances?.find(item => supportedCurrency(item.currency) === currency)
  return providerCents(bucket?.available_balance)
}

function ensureBalanceCovers(
  availableCents: number,
  totalDebitedCents: number,
  currency: PaymentCurrency
) {
  if (totalDebitedCents > availableCents) {
    throw createError({
      statusCode: 409,
      statusMessage: `This withdrawal requires ${currency} ${toDecimalString(totalDebitedCents)} including the Bachs fee, but only ${currency} ${toDecimalString(availableCents)} is available.`
    })
  }
}

export async function previewPaymentWithdrawal(owner: PaymentRecipientOwner, input: WithdrawalPreviewInput) {
  const { recipient, accountId } = await readyRecipient(owner)
  const destinations = await approvedDestinations(accountId)
  const destination = destinations.find(item => item.id === input.destinationId)
  if (!destination) {
    throw createError({ statusCode: 409, statusMessage: 'Choose an approved payout destination.' })
  }
  const destinationCurrency = supportedCurrency(destination.currency)!
  const availableCents = await availableBalanceCents(accountId, input.sourceCurrency)
  if (input.amountCents > availableCents) {
    throw createError({ statusCode: 409, statusMessage: 'Enter an amount within the currently available balance.' })
  }

  const method = payoutMethod(destination)
  let payload: ConfirmationPayload
  if (input.sourceCurrency === destinationCurrency) {
    const estimate = await estimateConnectedAccountPayout({
      accountId,
      fromCurrency: input.sourceCurrency,
      toCurrency: destinationCurrency,
      amount: toDecimalString(input.amountCents),
      payoutMethod: method
    })
    if (providerCents(estimate.amount) !== input.amountCents) {
      throw createError({ statusCode: 502, statusMessage: 'Bachs returned a withdrawal preview for a different amount. No money was moved.' })
    }
    const totalDebitedCents = requiredProviderCents(estimate.gross_from_amount, 'withdrawal total')
    const deliveredAmountCents = requiredProviderCents(estimate.to_amount, 'delivery amount')
    ensureBalanceCovers(availableCents, totalDebitedCents, input.sourceCurrency)
    payload = {
      v: PREVIEW_VERSION,
      recipientId: recipient.id,
      destinationId: destination.id,
      destinationName: destination.name.slice(0, 255),
      sourceCurrency: input.sourceCurrency,
      destinationCurrency,
      requestedAmountCents: input.amountCents,
      deliveredAmountCents,
      feeCents: providerCents(estimate.withdrawal_fee),
      totalDebitedCents,
      exchangeRate: estimate.exchange_rate ?? null,
      quoteId: null,
      expiresAt: Date.now() + PREVIEW_LIFETIME_MS
    }
  } else {
    // Bachs quotes lock the exchange rate, but the payout estimate is the
    // provider source of truth for the fee charged on top of the requested
    // amount. Check the fee-inclusive debit before creating a quote that the
    // connected account cannot afford.
    const estimate = await estimateConnectedAccountPayout({
      accountId,
      fromCurrency: input.sourceCurrency,
      toCurrency: destinationCurrency,
      amount: toDecimalString(input.amountCents),
      payoutMethod: method
    })
    if (providerCents(estimate.amount) !== input.amountCents) {
      throw createError({ statusCode: 502, statusMessage: 'Bachs returned a withdrawal estimate for a different amount. No money was moved.' })
    }
    const feeCents = providerCents(estimate.withdrawal_fee)
    const totalDebitedCents = requiredProviderCents(estimate.gross_from_amount, 'withdrawal total')
    ensureBalanceCovers(availableCents, totalDebitedCents, input.sourceCurrency)

    const quote = await createConnectedAccountPayoutQuote({
      accountId,
      fromCurrency: input.sourceCurrency,
      toCurrency: destinationCurrency,
      amount: toDecimalString(input.amountCents),
      payoutMethod: method
    })
    const quotedAmountCents = requiredProviderCents(quote.from_amount, 'quoted amount')
    const deliveredAmountCents = requiredProviderCents(quote.to_amount, 'quoted delivery amount')
    if (quotedAmountCents !== input.amountCents) {
      throw createError({ statusCode: 502, statusMessage: 'Bachs returned a withdrawal quote for a different amount. No money was moved.' })
    }
    const providerExpiry = Date.parse(quote.expires_at) - PROVIDER_EXPIRY_SAFETY_MS
    payload = {
      v: PREVIEW_VERSION,
      recipientId: recipient.id,
      destinationId: destination.id,
      destinationName: destination.name.slice(0, 255),
      sourceCurrency: input.sourceCurrency,
      destinationCurrency,
      requestedAmountCents: input.amountCents,
      deliveredAmountCents,
      feeCents,
      totalDebitedCents,
      exchangeRate: quote.exchange_rate,
      quoteId: quote.quote_id,
      expiresAt: Math.min(Date.now() + PREVIEW_LIFETIME_MS, providerExpiry)
    }
    if (payload.expiresAt <= Date.now()) {
      throw createError({ statusCode: 503, statusMessage: 'Bachs returned an expired withdrawal quote. No money was moved.' })
    }
  }

  return {
    confirmationToken: createConfirmationToken(payload),
    sourceCurrency: payload.sourceCurrency,
    destinationCurrency: payload.destinationCurrency,
    requestedAmountCents: payload.requestedAmountCents,
    deliveredAmountCents: payload.deliveredAmountCents,
    feeCents: payload.feeCents,
    totalDebitedCents: payload.totalDebitedCents,
    exchangeRate: payload.exchangeRate,
    destination: publicDestination(destination),
    expiresAt: new Date(payload.expiresAt).toISOString()
  }
}

export async function paymentWithdrawalOptions(owner: PaymentRecipientOwner) {
  const current = await findPaymentRecipient(owner)
  if (!current?.bachsAccountId) {
    return { ready: false, status: current?.status ?? 'not_started', available: [], destinations: [], withdrawals: [] }
  }
  const recipient = await syncPaymentRecipient(current)
  if (recipient.status !== 'active') {
    return { ready: false, status: recipient.status, available: [], destinations: [], withdrawals: [] }
  }
  const accountId = recipient.bachsAccountId
  if (!accountId) {
    return { ready: false, status: 'onboarding' as const, available: [], destinations: [], withdrawals: [] }
  }

  const [balance, destinations, payouts] = await Promise.all([
    getConnectedAccountBalance(accountId),
    approvedDestinations(accountId),
    listConnectedAccountPayouts(accountId)
  ])
  await reconcileWithdrawalRows(recipient.id, payouts)
  const rows = await useDatabase().select().from(paymentWithdrawals)
    .where(eq(paymentWithdrawals.recipientId, recipient.id))
    .orderBy(desc(paymentWithdrawals.createdAt))
    .limit(10)

  const available = (balance.balances ?? []).flatMap((bucket) => {
    const currency = supportedCurrency(bucket.currency)
    if (!currency) return []
    return [{ currency, amountCents: providerCents(bucket.available_balance) }]
  }).sort((left, right) => left.currency.localeCompare(right.currency))

  return {
    ready: true,
    status: recipient.status,
    available,
    destinations: destinations.map(publicDestination),
    withdrawals: rows.map(publicWithdrawal)
  }
}

export async function createPaymentWithdrawal(input: {
  owner: PaymentRecipientOwner
  actorUserId: string
  request: WithdrawalCreateInput
}) {
  const confirmation = readConfirmationToken(input.request.confirmationToken)
  const { recipient, accountId } = await readyRecipient(input.owner)
  if (confirmation.recipientId !== recipient.id) throw invalidPreview()

  const destinations = await approvedDestinations(accountId)
  const destination = destinations.find(item => item.id === confirmation.destinationId)
  if (!destination || supportedCurrency(destination.currency) !== confirmation.destinationCurrency) {
    throw createError({ statusCode: 409, statusMessage: 'The payout destination changed after the preview. Review the withdrawal again.' })
  }
  const availableCents = await availableBalanceCents(accountId, confirmation.sourceCurrency)
  ensureBalanceCovers(availableCents, confirmation.totalDebitedCents, confirmation.sourceCurrency)

  const reference = `schedra-wd-${input.request.requestId}`
  const values: typeof paymentWithdrawals.$inferInsert = {
    id: input.request.requestId,
    recipientId: recipient.id,
    requestedByUserId: input.actorUserId,
    reference,
    destinationId: confirmation.destinationId,
    destinationName: confirmation.destinationName,
    sourceCurrency: confirmation.sourceCurrency,
    destinationCurrency: confirmation.destinationCurrency,
    requestedAmountCents: confirmation.requestedAmountCents,
    deliveredAmountCents: confirmation.deliveredAmountCents,
    feeCents: confirmation.feeCents,
    totalDebitedCents: confirmation.totalDebitedCents,
    status: 'creating'
  }
  const [inserted] = await useDatabase().insert(paymentWithdrawals).values(values)
    .onConflictDoNothing({ target: paymentWithdrawals.id })
    .returning()
  let row = inserted
  if (!row) {
    const [existing] = await useDatabase().select().from(paymentWithdrawals)
      .where(eq(paymentWithdrawals.id, input.request.requestId)).limit(1)
    if (!existing || !sameWithdrawal(existing, values)) {
      throw createError({ statusCode: 409, statusMessage: 'This withdrawal request identifier has already been used.' })
    }
    if (!NON_TERMINAL_STATUSES.includes(existing.status as typeof NON_TERMINAL_STATUSES[number])) {
      return publicWithdrawal(existing)
    }
    row = await reconcileOneWithdrawal(existing, accountId)
    if (row.bachsPayoutId || row.status === 'pending' || row.status === 'processing' || row.status === 'completed') {
      return publicWithdrawal(row)
    }
  }

  try {
    const payout = await createConnectedAccountPayout({
      accountId,
      destinationId: confirmation.destinationId,
      reference,
      ...(confirmation.quoteId
        ? { quoteId: confirmation.quoteId }
        : { amount: toDecimalString(confirmation.requestedAmountCents) }),
      metadata: {
        schedra_withdrawal_id: input.request.requestId,
        schedra_recipient_id: recipient.id
      }
    })
    const updated = await applyProviderPayout(row.id, payout)
    logEvent('info', 'payment_withdrawal_accepted', {
      withdrawalId: row.id,
      recipientId: recipient.id,
      providerPayoutId: payout.id,
      status: payout.status,
      sourceCurrency: payout.source_currency ?? confirmation.sourceCurrency,
      destinationCurrency: payout.currency
    })
    return publicWithdrawal(updated)
  } catch (error) {
    const reconciled = await findPayoutByReference(accountId, reference).catch(() => null)
    if (reconciled) return publicWithdrawal(await applyProviderPayout(row.id, reconciled))

    if (isAmbiguousProviderFailure(error)) {
      const [unknown] = await useDatabase().update(paymentWithdrawals).set({
        status: 'unknown',
        failureReason: 'Bachs received the request, but Schedra could not confirm its current state yet.',
        lastCheckedAt: sql`now()`,
        updatedAt: sql`now()`
      }).where(eq(paymentWithdrawals.id, row.id)).returning()
      logEvent('error', 'payment_withdrawal_state_unknown', {
        withdrawalId: row.id,
        recipientId: recipient.id,
        reference,
        error
      })
      return publicWithdrawal(unknown ?? row)
    }

    const message = withdrawalErrorMessage(error)
    await useDatabase().update(paymentWithdrawals).set({
      status: 'failed',
      failureReason: message,
      completedAt: sql`now()`,
      lastCheckedAt: sql`now()`,
      updatedAt: sql`now()`
    }).where(eq(paymentWithdrawals.id, row.id))
    throw createError({ statusCode: 409, statusMessage: message })
  }
}

function sameWithdrawal(
  row: typeof paymentWithdrawals.$inferSelect,
  expected: typeof paymentWithdrawals.$inferInsert
) {
  return row.recipientId === expected.recipientId
    && row.destinationId === expected.destinationId
    && row.sourceCurrency === expected.sourceCurrency
    && row.destinationCurrency === expected.destinationCurrency
    && row.requestedAmountCents === expected.requestedAmountCents
}

function isAmbiguousProviderFailure(error: unknown) {
  if (!isHttpError(error)) return true
  return error.statusCode === 409 || error.statusCode >= 500
}

function withdrawalErrorMessage(error: unknown) {
  const code = isHttpError(error) ? error.data?.errorCode : undefined
  if (code === 'INSUFFICIENT_BALANCE') return 'The available balance no longer covers this withdrawal and its provider fee.'
  if (code === 'QUOTE_EXPIRED') return 'The withdrawal quote expired. Review the latest rate before trying again.'
  if (code === 'DESTINATION_PENDING_REVIEW') return 'Bachs is still reviewing this payout destination.'
  if (code === 'DESTINATION_REJECTED' || code === 'DESTINATION_NOT_FOUND') return 'This payout destination can no longer receive withdrawals.'
  if (code === 'PAYOUTS_NOT_ENABLED' || (isHttpError(error) && error.statusCode === 403)) return 'Bachs has not enabled withdrawals for this account.'
  if (code === 'WITHDRAWAL_LIMIT_EXCEEDED' || code === 'DAILY_WITHDRAWAL_LIMIT_EXCEEDED') {
    return 'This withdrawal exceeds the limit currently allowed by Bachs.'
  }
  return 'Bachs could not accept this withdrawal. No confirmed payout was created.'
}

async function findPayoutByReference(accountId: string, reference: string) {
  const payouts = await listConnectedAccountPayouts(accountId)
  return payouts.find(payout => payout.reference === reference) ?? null
}

async function reconcileOneWithdrawal(row: typeof paymentWithdrawals.$inferSelect, accountId: string) {
  const payout = row.bachsPayoutId
    ? await getConnectedAccountPayout(accountId, row.bachsPayoutId).catch(() => null)
    : await findPayoutByReference(accountId, row.reference).catch(() => null)
  return payout ? applyProviderPayout(row.id, payout) : row
}

async function reconcileWithdrawalRows(recipientId: string, payouts: readonly BachsPayout[]) {
  const rows = await useDatabase().select().from(paymentWithdrawals).where(and(
    eq(paymentWithdrawals.recipientId, recipientId),
    inArray(paymentWithdrawals.status, [...NON_TERMINAL_STATUSES])
  ))
  const byId = new Map(payouts.map(payout => [payout.id, payout]))
  const byReference = new Map(payouts.flatMap(payout => payout.reference ? [[payout.reference, payout] as const] : []))
  await Promise.all(rows.map((row) => {
    const payout = (row.bachsPayoutId ? byId.get(row.bachsPayoutId) : null) ?? byReference.get(row.reference)
    return payout ? applyProviderPayout(row.id, payout) : Promise.resolve(row)
  }))
}

async function applyProviderPayout(withdrawalId: string, payout: BachsPayout, providerEventId?: string) {
  const sourceCurrency = supportedCurrency(payout.source_currency ?? payout.currency)
  const destinationCurrency = supportedCurrency(payout.currency)
  if (!sourceCurrency || !destinationCurrency) {
    throw new Error(`Unsupported payout currency returned for ${payout.id}.`)
  }
  const terminal = payout.status === 'completed' || payout.status === 'failed'
  const completedAt = payout.completed_at ? new Date(payout.completed_at) : terminal ? sql`now()` : null
  const deliveredAmountCents = requiredProviderCents(payout.amount, 'payout amount')
  const [updated] = await useDatabase().update(paymentWithdrawals).set({
    bachsPayoutId: payout.id,
    status: payout.status,
    sourceCurrency,
    destinationCurrency,
    deliveredAmountCents,
    feeCents: payout.fee == null ? null : providerCents(payout.fee),
    totalDebitedCents: payout.total_debited == null ? null : providerCents(payout.total_debited),
    failureReason: payout.failure_reason ?? null,
    providerEventId: providerEventId ?? undefined,
    completedAt,
    lastCheckedAt: sql`now()`,
    updatedAt: sql`now()`
  }).where(eq(paymentWithdrawals.id, withdrawalId)).returning()
  if (!updated) throw new Error('Withdrawal disappeared during provider reconciliation.')
  return updated
}

export async function applyWithdrawalPayoutEvent(input: {
  accountId: string
  payoutId?: string | null
  reference?: string | null
  providerEventId?: string
}) {
  if (!input.payoutId && !input.reference) return false
  const matches = []
  if (input.payoutId) matches.push(eq(paymentWithdrawals.bachsPayoutId, input.payoutId))
  if (input.reference) matches.push(eq(paymentWithdrawals.reference, input.reference))
  const [match] = await useDatabase().select({ withdrawalId: paymentWithdrawals.id })
    .from(paymentWithdrawals)
    .innerJoin(paymentRecipients, eq(paymentRecipients.id, paymentWithdrawals.recipientId))
    .where(and(
      eq(paymentRecipients.bachsAccountId, input.accountId),
      matches.length === 1 ? matches[0] : or(...matches)
    ))
    .limit(1)
  if (!match || !input.payoutId) return false
  const payout = await getConnectedAccountPayout(input.accountId, input.payoutId)
  await applyProviderPayout(match.withdrawalId, payout, input.providerEventId)
  return true
}
