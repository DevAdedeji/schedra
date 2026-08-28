import { and, eq, isNull } from 'drizzle-orm'
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

function ownerWhere(owner: PaymentRecipientOwner) {
  return 'userId' in owner && owner.userId
    ? and(eq(paymentRecipients.userId, owner.userId), isNull(paymentRecipients.organizationId))
    : and(eq(paymentRecipients.organizationId, owner.organizationId!), isNull(paymentRecipients.userId))
}

export function recipientStatus(account: BachsConnectedAccount) {
  if (account.is_active === false) return 'disabled' as const
  const requirements = account.requirements
  // Requirements are the authoritative onboarding gate. A provider can report
  // a capability as active before the hosted flow has collected the account
  // holder and payout destination (the sandbox does this in particular). Never
  // let that contradictory capability flag unlock paid bookings.
  if (requirements?.errors?.length || requirements?.past_due?.length) return 'restricted' as const
  if (requirements?.currently_due?.length) return 'onboarding' as const

  const payout = account.capabilities?.payouts
  if (
    requirements?.pending_verification?.length
    || requirements?.setup_status === 'awaiting_review'
    || account.setup_status === 'awaiting_review'
    || payout?.status === 'pending'
  ) {
    return 'pending_review' as const
  }
  if (payout?.requested && ['restricted', 'unsupported'].includes(payout.status ?? '')) {
    return 'restricted' as const
  }
  if (payout?.status === 'active') return 'active' as const
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
    lastError: row?.lastError ?? null,
    lastCheckedAt: row?.lastCheckedAt?.toISOString() ?? null
  }
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
      lastCheckedAt: new Date(),
      updatedAt: new Date()
    }).where(eq(paymentRecipients.id, row.id)).returning()
    return updated ?? row
  } catch (error) {
    await useDatabase().update(paymentRecipients).set({
      lastError: error instanceof Error ? error.message.slice(0, 1000) : 'Could not check the payment account.',
      lastCheckedAt: new Date(),
      updatedAt: new Date()
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
      lastCheckedAt: new Date(),
      lastError: null
    }
    const [saved] = row
      ? await useDatabase().update(paymentRecipients).set(values)
          .where(eq(paymentRecipients.id, row.id)).returning()
      : await useDatabase().insert(paymentRecipients).values(values).returning()
    if (!saved) throw new Error('Payment account could not be saved.')
    row = saved
  }

  const accountId = row?.bachsAccountId
  if (!accountId) throw new Error('Payment account setup did not return an account.')
  await prefillRepresentativeIfRequired(accountId, representative)
  const base = useEnv().schedraUrl
  const path = input.returnPath.startsWith('/') ? input.returnPath : `/${input.returnPath}`
  const link = await createConnectedAccountLink({
    accountId,
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
    lastCheckedAt: new Date(),
    updatedAt: new Date()
  }).where(eq(paymentRecipients.id, row.id))
  return true
}
