import { and, eq, inArray, isNull } from 'drizzle-orm'
import {
  PERSONAL_PRO_PLAN,
  personalProPriceCents,
  type BillingInterval,
  type OrganizationPlanStatus,
  type PersonalPlanEntitlement,
  type PersonalTeamCoverage
} from '#shared/billing'
import { members, organizations, organizationSubscriptions, personalSubscriptions } from '../database/schema'
import { useDatabase } from '../database'
import { addToInstant } from '../utils/date-time'
import { useEnv } from '../config/env'
import { organizationEntitlement } from './entitlement'

function personalGraceEnd(periodEnd: Date) {
  return addToInstant(periodEnd, { hours: PERSONAL_PRO_PLAN.graceDays * 24 })
}

export async function paidTeamCoverageForUser(
  userId: string,
  now = new Date()
): Promise<PersonalTeamCoverage | null> {
  const candidates = await useDatabase().select({
    organizationId: organizations.id,
    name: organizations.name,
    slug: organizations.slug
  }).from(members)
    .innerJoin(organizations, eq(organizations.id, members.organizationId))
    .innerJoin(organizationSubscriptions, eq(organizationSubscriptions.organizationId, organizations.id))
    .where(and(
      eq(members.userId, userId),
      isNull(organizations.archivedAt),
      inArray(organizationSubscriptions.status, ['active', 'past_due'])
    ))

  for (const candidate of candidates) {
    const entitlement = await organizationEntitlement(candidate.organizationId, now)
    if (entitlement.readOnly || entitlement.status === 'trialing' || !entitlement.currentPeriodEnd) continue
    return {
      ...candidate,
      status: entitlement.status,
      interval: entitlement.interval,
      currentPeriodEnd: entitlement.currentPeriodEnd
    }
  }
  return null
}

export async function personalPlanEntitlement(
  userId: string,
  now = new Date()
): Promise<PersonalPlanEntitlement> {
  const [[row], teamCoverage] = await Promise.all([
    useDatabase().select().from(personalSubscriptions)
      .where(eq(personalSubscriptions.userId, userId))
      .limit(1),
    paidTeamCoverageForUser(userId, now)
  ])

  if (!row) {
    const isPro = Boolean(teamCoverage)
    return {
      plan: isPro ? 'pro' : 'free',
      status: teamCoverage?.status ?? 'free',
      source: isPro ? 'team' : 'free',
      interval: teamCoverage?.interval ?? 'yearly',
      isPro,
      currentPeriodEnd: teamCoverage?.currentPeriodEnd ?? null,
      personalCurrentPeriodEnd: null,
      graceEndsAt: null,
      cancelAtPeriodEnd: false,
      nextInvoiceCents: PERSONAL_PRO_PLAN.yearlyCents,
      autoRenews: false,
      teamCoverage
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
  const hasPersonalPro = hasKnownTerm && (providerManagedAccess || paidTermAccess)
  const isPro = hasPersonalPro || Boolean(teamCoverage)

  return {
    plan: isPro ? 'pro' : 'free',
    status: hasPersonalPro ? status : (teamCoverage?.status ?? status),
    source: hasPersonalPro
      ? (teamCoverage ? 'personal_and_team' : 'personal')
      : (teamCoverage ? 'team' : 'free'),
    interval: hasPersonalPro ? interval : (teamCoverage?.interval ?? interval),
    isPro,
    currentPeriodEnd: teamCoverage?.currentPeriodEnd
      ?? (hasPersonalPro ? row.currentPeriodEnd?.toISOString() ?? null : null),
    personalCurrentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    graceEndsAt: graceEndsAt?.toISOString() ?? null,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    nextInvoiceCents: personalProPriceCents(interval),
    autoRenews: row.collectionMethod === 'charge_automatically'
      && status === 'active'
      && !row.cancelAtPeriodEnd,
    teamCoverage
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
