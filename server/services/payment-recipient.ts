import { and, eq, isNull, sql } from 'drizzle-orm'
import {
  createConnectedAccount,
  createConnectedAccountLink,
  getConnectedAccount,
  updateConnectedAccountRepresentative,
  type BachsConnectedAccount
} from '../integrations/bachs'
import { paymentRecipients } from '../database/schema'
import { useDatabase } from '../database'
import { useEnv } from '../config/env'
import { logEvent } from '../observability/logger'

export type PaymentRecipientOwner
  = | { userId: string, organizationId?: never }
    | { organizationId: string, userId?: never }

const REVIEW_STATUSES = new Set([
  'awaiting_review',
  'in_review',
  'pending',
  'pending_review',
  'submitted',
  'under_review',
  'verification_pending',
  'verifying'
])
const COMPLETE_STATUSES = new Set(['active', 'approved', 'complete', 'completed', 'enabled', 'verified'])
const RESTRICTED_STATUSES = new Set(['declined', 'rejected', 'restricted', 'suspended', 'unsupported'])
const DISABLED_STATUSES = new Set(['closed', 'deactivated', 'disabled'])

function providerStatus(value?: string | null) {
  return value?.trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_') ?? ''
}

function ownerWhere(owner: PaymentRecipientOwner) {
  return 'userId' in owner && owner.userId
    ? and(eq(paymentRecipients.userId, owner.userId), isNull(paymentRecipients.organizationId))
    : and(eq(paymentRecipients.organizationId, owner.organizationId!), isNull(paymentRecipients.userId))
}

export function recipientStatus(account: BachsConnectedAccount) {
  const accountStatus = providerStatus(account.status)
  const setupStatus = providerStatus(
    account.requirements?.setup_status
    ?? account.setup_status
    ?? account.onboarding_status
  )
  if (account.is_active === false || DISABLED_STATUSES.has(accountStatus)) return 'disabled' as const
  const requirements = account.requirements
  const payout = account.capabilities?.payouts
  const transfer = account.capabilities?.transfers
  const payoutStatus = providerStatus(payout?.status)
  const transferStatus = providerStatus(transfer?.status)

  // Requirements are the authoritative onboarding gate. A provider can report
  // a capability as active before the hosted flow has collected the account
  // holder and payout destination (the sandbox does this in particular). Never
  // let that contradictory capability flag unlock paid bookings.
  if (requirements?.errors?.length || requirements?.past_due?.length) return 'restricted' as const
  if (requirements?.currently_due?.length) return 'onboarding' as const
  if (RESTRICTED_STATUSES.has(accountStatus)
    || RESTRICTED_STATUSES.has(setupStatus)
    || RESTRICTED_STATUSES.has(payoutStatus)
    || RESTRICTED_STATUSES.has(transferStatus)) return 'restricted' as const

  // Bachs can return active capability flags while the account-wide setup is
  // still incomplete. The hosted checklist is the source of truth: funds must
  // not be accepted until the payout destination and identity steps are done.
  if (account.details_submitted === false || accountStatus === 'incomplete' || setupStatus === 'incomplete') {
    return 'onboarding' as const
  }

  if (
    requirements?.pending_verification?.length
    || REVIEW_STATUSES.has(accountStatus)
    || REVIEW_STATUSES.has(setupStatus)
    || REVIEW_STATUSES.has(payoutStatus)
    || REVIEW_STATUSES.has(transferStatus)
  ) {
    return 'pending_review' as const
  }

  // A destination charge needs transfers, and the recipient needs payouts to
  // receive the proceeds. Both must be explicitly active. Account-level flags,
  // when Bachs supplies them, are additional vetoes rather than substitutes.
  const moneyMovementReady = payoutStatus === 'active' && transferStatus === 'active'
  const providerFlagsReady = account.payouts_enabled !== false && account.transfers_enabled !== false
  if (moneyMovementReady && providerFlagsReady) return 'active' as const

  // Submitted/complete account details with capabilities still unavailable is
  // a provider review state, not a prompt to collect bank details in Schedra.
  if (account.details_submitted === true
    || COMPLETE_STATUSES.has(accountStatus)
    || COMPLETE_STATUSES.has(setupStatus)) return 'pending_review' as const
  return 'onboarding' as const
}

export async function findPaymentRecipient(owner: PaymentRecipientOwner) {
  const [row] = await useDatabase().select().from(paymentRecipients)
    .where(ownerWhere(owner)).limit(1)
  return row ?? null
}

export function publicRecipient(row: Awaited<ReturnType<typeof findPaymentRecipient>>) {
  return {
    configured: Boolean(row?.bachsAccountId),
    status: row?.status ?? 'not_started',
    ready: row?.status === 'active',
    nextAction: recipientNextAction(row),
    lastError: row?.lastError ?? null,
    lastCheckedAt: row?.lastCheckedAt?.toISOString() ?? null
  }
}

export function recipientNextAction(row: Awaited<ReturnType<typeof findPaymentRecipient>>) {
  if (!row?.bachsAccountId) return 'provider_onboarding' as const
  if (row.status === 'active' || row.status === 'pending_review') return 'none' as const
  return 'provider_onboarding' as const
}

export async function syncPaymentRecipient(row: NonNullable<Awaited<ReturnType<typeof findPaymentRecipient>>>) {
  if (!row.bachsAccountId) return row
  try {
    const account = await getConnectedAccount(row.bachsAccountId)
    const [updated] = await useDatabase().update(paymentRecipients).set({
      status: recipientStatus(account),
      capabilities: account.capabilities ?? {},
      requirements: account.requirements ?? {},
      lastError: null,
      lastCheckedAt: sql`now()`,
      updatedAt: sql`now()`
    }).where(eq(paymentRecipients.id, row.id)).returning()
    return updated ?? row
  } catch (error) {
    await useDatabase().update(paymentRecipients).set({
      lastError: error instanceof Error ? error.message.slice(0, 1000) : 'Could not check the payment account.',
      lastCheckedAt: sql`now()`,
      updatedAt: sql`now()`
    }).where(eq(paymentRecipients.id, row.id))
    throw error
  }
}

export async function createPaymentOnboarding(input: {
  owner: PaymentRecipientOwner
  email: string
  name: string
  representativeName?: string
  returnPath: string
}) {
  const representative = splitRepresentativeName(input.representativeName ?? input.name)
  let row = await findPaymentRecipient(input.owner)
  if (!row?.bachsAccountId) {
    const reference = 'userId' in input.owner
      ? `user-${input.owner.userId}`
      : `organization-${input.owner.organizationId}`
    const account = await createConnectedAccount({
      email: input.email,
      name: input.name,
      firstName: representative.firstName,
      lastName: representative.lastName,
      reference,
      entityType: 'userId' in input.owner ? 'individual' : 'company'
    })
    const values = {
      ...input.owner,
      bachsAccountId: account.id,
      status: recipientStatus(account),
      capabilities: account.capabilities ?? {},
      requirements: account.requirements ?? {},
      lastCheckedAt: sql`now()`,
      lastError: null,
      updatedAt: sql`now()`
    }
    const [saved] = row
      ? await useDatabase().update(paymentRecipients).set(values)
          .where(eq(paymentRecipients.id, row.id)).returning()
      : await useDatabase().insert(paymentRecipients).values(values).returning()
    if (!saved) throw new Error('Payment account could not be saved.')
    row = saved
  }

  // Refresh before choosing the link type. This prevents a stale local status
  // from sending a completed account through onboarding again.
  if (row?.bachsAccountId) row = await syncPaymentRecipient(row)
  const accountId = row?.bachsAccountId
  if (!accountId) throw new Error('Payment account setup did not return an account.')
  await prefillRepresentativeIfRequired(accountId, representative)
  const base = useEnv().schedraUrl
  const path = input.returnPath.startsWith('/') ? input.returnPath : `/${input.returnPath}`
  const link = await createConnectedAccountLink({
    accountId,
    type: row.status === 'active' ? 'update' : 'onboarding',
    returnUrl: `${base}${path}?payments=returned`,
    refreshUrl: `${base}${path}?payments=refresh`
  })
  return { url: link.url, expiresAt: link.expires_at }
}

function splitRepresentativeName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  return {
    firstName: parts.shift() ?? '',
    lastName: parts.length ? parts.join(' ') : undefined
  }
}

async function prefillRepresentativeIfRequired(
  accountId: string,
  representative: ReturnType<typeof splitRepresentativeName>
) {
  if (!representative.firstName) return
  try {
    const account = await getConnectedAccount(accountId)
    const due = account.requirements?.currently_due ?? []
    const personNameDue = due.some(field =>
      field === 'persons.name'
      || field.endsWith('.first_name')
      || field.endsWith('.last_name')
    )
    if (!personNameDue || account.requirements?.persons?.length) return
    await updateConnectedAccountRepresentative({ accountId, ...representative })
  } catch (error) {
    // Prefilling is an optimization. The hosted flow must remain available if
    // Bachs cannot accept the prefill, otherwise a convenience becomes a hard
    // onboarding outage.
    logEvent('warn', 'payment_recipient_prefill_failed', {
      accountId,
      error: error instanceof Error ? error.message : 'Unknown provider error'
    })
  }
}

export async function updateRecipientFromWebhook(account: BachsConnectedAccount) {
  if (!account.id) return false
  const [row] = await useDatabase().select().from(paymentRecipients)
    .where(eq(paymentRecipients.bachsAccountId, account.id)).limit(1)
  if (!row) return false
  await useDatabase().update(paymentRecipients).set({
    status: recipientStatus(account),
    capabilities: account.capabilities ?? row.capabilities,
    requirements: account.requirements ?? row.requirements,
    lastError: null,
    lastCheckedAt: sql`now()`,
    updatedAt: sql`now()`
  }).where(eq(paymentRecipients.id, row.id))
  return true
}
