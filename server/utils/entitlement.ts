import { count, eq } from 'drizzle-orm'
import type { BillingInterval, OrganizationEntitlement, OrganizationPlanStatus } from '#shared/billing'
import { TEAM_PLAN, invoiceTotalCents } from '#shared/billing'
import { members, organizationSubscriptions } from '../database/schema'
import { useDatabase } from './database'

const DAY_MS = 24 * 60 * 60 * 1000

function addDays(from: Date, days: number) {
  return new Date(from.getTime() + days * DAY_MS)
}

function daysUntil(target: Date | null, now: Date) {
  if (!target) return null
  return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / DAY_MS))
}

/**
 * A subscription row can be stale — Bachs webhooks arrive late, and nothing
 * charges a bank transfer on our behalf. Deriving expiry on read means access
 * is correct even when no sweep has run yet.
 */
function settle(
  row: typeof organizationSubscriptions.$inferSelect,
  now: Date
): { status: OrganizationPlanStatus, graceEndsAt: Date | null } {
  if (row.status === 'canceled') return { status: 'canceled', graceEndsAt: null }

  if (row.status === 'trialing') {
    if (row.trialEndsAt && now > row.trialEndsAt) {
      return { status: 'past_due', graceEndsAt: addDays(row.trialEndsAt, TEAM_PLAN.graceDays) }
    }
    return { status: 'trialing', graceEndsAt: null }
  }

  if (row.status === 'active' && row.currentPeriodEnd && now > row.currentPeriodEnd) {
    return { status: 'past_due', graceEndsAt: addDays(row.currentPeriodEnd, TEAM_PLAN.graceDays) }
  }

  if (row.status === 'past_due') {
    return {
      status: 'past_due',
      graceEndsAt: row.graceEndsAt ?? addDays(row.updatedAt, TEAM_PLAN.graceDays)
    }
  }

  return { status: row.status as OrganizationPlanStatus, graceEndsAt: row.graceEndsAt }
}

export async function organizationEntitlement(
  organizationId: string,
  now = new Date()
): Promise<OrganizationEntitlement> {
  const db = useDatabase()
  const [[row], [seatRow]] = await Promise.all([
    db.select().from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, organizationId)).limit(1),
    db.select({ value: count() }).from(members).where(eq(members.organizationId, organizationId))
  ])

  const seatsUsed = seatRow?.value ?? 0

  // No row means the team predates billing or its creation hook failed;
  // treat it as expired rather than handing out a free team plan.
  if (!row) {
    return {
      status: 'canceled',
      interval: 'yearly',
      seatsUsed,
      seatLimit: 0,
      canAddMembers: false,
      readOnly: true,
      trialEndsAt: null,
      graceEndsAt: null,
      currentPeriodEnd: null,
      daysLeftInTrial: null,
      nextInvoiceCents: 0
    }
  }

  const { status, graceEndsAt } = settle(row, now)
  const interval = row.interval as BillingInterval

  const seatLimit = status === 'trialing' ? TEAM_PLAN.trialSeatLimit : TEAM_PLAN.maxSeats
  const readOnly = status === 'canceled' || (status === 'past_due' && Boolean(graceEndsAt && now > graceEndsAt))
  const canAddMembers = (status === 'trialing' || status === 'active')
    && seatsUsed < seatLimit
    && seatsUsed < TEAM_PLAN.maxSeats

  return {
    status,
    interval,
    seatsUsed,
    seatLimit,
    canAddMembers,
    readOnly,
    trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
    graceEndsAt: graceEndsAt?.toISOString() ?? null,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    daysLeftInTrial: status === 'trialing' ? daysUntil(row.trialEndsAt, now) : null,
    nextInvoiceCents: invoiceTotalCents(seatsUsed, interval)
  }
}

export async function startTrial(organizationId: string, now = new Date()) {
  await useDatabase().insert(organizationSubscriptions).values({
    organizationId,
    status: 'trialing',
    interval: 'yearly',
    trialEndsAt: addDays(now, TEAM_PLAN.trialDays)
  }).onConflictDoNothing()
}

/**
 * Seats are billed as occupied, so this is not a purchased-seat check: it stops
 * a team growing while it is behind on payment, over the trial allowance,
 * or at the hard ceiling.
 */
export async function assertCanAddMember(organizationId: string) {
  const entitlement = await organizationEntitlement(organizationId)
  if (entitlement.canAddMembers) return entitlement

  if (entitlement.status === 'trialing') {
    throw createError({
      statusCode: 402,
      statusMessage: `Trials are limited to ${TEAM_PLAN.trialSeatLimit} members. Start a subscription to add more.`
    })
  }
  if (entitlement.seatsUsed >= TEAM_PLAN.maxSeats) {
    throw createError({
      statusCode: 409,
      statusMessage: `This team has reached the limit of ${TEAM_PLAN.maxSeats} members.`
    })
  }
  throw createError({
    statusCode: 402,
    statusMessage: 'This team is not on an active subscription, so new members cannot be added yet.'
  })
}

/** Blocks writes on a team whose grace period has run out. */
export async function assertTeamWritable(organizationId: string) {
  const entitlement = await organizationEntitlement(organizationId)
  if (!entitlement.readOnly) return entitlement

  throw createError({
    statusCode: 402,
    statusMessage: 'This team is read-only until its subscription is renewed.'
  })
}
