import { eq } from 'drizzle-orm'
import {
  PERSONAL_PRO_PLAN,
  personalProPriceCents,
  type BillingInterval,
  type OrganizationPlanStatus,
  type PersonalPlanEntitlement
} from '#shared/billing'
import { personalSubscriptions } from '../database/schema'
import { useDatabase } from '../database'
import { addToInstant } from '../utils/date-time'
import { useEnv } from '../config/env'

function personalGraceEnd(periodEnd: Date) {
  return addToInstant(periodEnd, { hours: PERSONAL_PRO_PLAN.graceDays * 24 })
}

export async function personalPlanEntitlement(
  userId: string,
  now = new Date()
): Promise<PersonalPlanEntitlement> {
  const [row] = await useDatabase().select().from(personalSubscriptions)
    .where(eq(personalSubscriptions.userId, userId))
    .limit(1)

  if (!row) {
    return {
      plan: 'free',
      status: 'free',
      interval: 'yearly',
      isPro: false,
      currentPeriodEnd: null,
      graceEndsAt: null,
      cancelAtPeriodEnd: false,
      nextInvoiceCents: PERSONAL_PRO_PLAN.yearlyCents,
      autoRenews: false
    }
  }

  const interval = row.interval as BillingInterval
  let status = row.status as OrganizationPlanStatus
  let graceEndsAt = row.graceEndsAt

  if (row.collectionMethod === 'invoice' && row.currentPeriodEnd && now > row.currentPeriodEnd) {
    graceEndsAt ??= personalGraceEnd(row.currentPeriodEnd)
    if (status === 'active') status = 'past_due'
  }

  const insideInvoiceGrace = row.collectionMethod === 'invoice'
    && status === 'past_due'
    && Boolean(graceEndsAt && now <= graceEndsAt)
  const providerManagedAccess = row.collectionMethod === 'charge_automatically'
    && ['trialing', 'active', 'past_due'].includes(status)
  const paidTermAccess = row.collectionMethod === 'invoice'
    && (status === 'active' || insideInvoiceGrace)
  const hasKnownTerm = Boolean(row.currentPeriodEnd)
  const isPro = hasKnownTerm && (providerManagedAccess || paidTermAccess)

  return {
    plan: isPro ? 'pro' : 'free',
    status,
    interval,
    isPro,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    graceEndsAt: graceEndsAt?.toISOString() ?? null,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    nextInvoiceCents: personalProPriceCents(interval),
    autoRenews: row.collectionMethod === 'charge_automatically'
      && status === 'active'
      && !row.cancelAtPeriodEnd
  }
}

export async function assertPersonalPro(userId: string) {
  const entitlement = await personalPlanEntitlement(userId)
  if (entitlement.isPro) return entitlement
  throw createError({
    statusCode: 402,
    statusMessage: 'Personal Pro is required for this feature.',
    data: { code: 'PERSONAL_PRO_REQUIRED' }
  })
}

export async function personalPaidBookingFeeBps(userId: string) {
  const entitlement = await personalPlanEntitlement(userId)
  return entitlement.isPro
    ? Math.min(useEnv().paidBookingPlatformFeeBps, PERSONAL_PRO_PLAN.paidBookingFeeBps)
    : useEnv().paidBookingPlatformFeeBps
}
