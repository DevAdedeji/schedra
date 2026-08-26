import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { TEAM_PLAN, formatUsd, invoiceTotalCents, type BillingInterval } from '#shared/billing'
import { members, organizationSubscriptions, organizations, users } from '../database/schema'
import { useDatabase } from '../database'
import { emailDedupeKey, enqueueEmails } from './email-outbox'
import { useEnv } from '../config/env'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Bachs retries a saved card on its own, so a subscription needs no chasing.
 * Only the invoice path does: nothing can charge a bank transfer for us, so a
 * team that is never reminded simply lapses.
 */
type Stage = 'trial_ending' | 'trial_over' | 'period_ending' | 'grace' | 'locked'

interface Due {
  organizationId: string
  name: string
  slug: string
  stage: Stage
  seats: number
  interval: BillingInterval
  deadline: Date
}

function daysBetween(from: Date, to: Date) {
  return Math.ceil((to.getTime() - from.getTime()) / DAY_MS)
}

function stageFor(row: {
  status: string
  trialEndsAt: Date | null
  currentPeriodEnd: Date | null
}, now: Date): Stage | null {
  const deadline = row.status === 'trialing' ? row.trialEndsAt : row.currentPeriodEnd
  if (!deadline) return null

  const days = daysBetween(now, deadline)
  const trialing = row.status === 'trialing'

  // One message per stage, not one per day: a nag every morning gets filtered.
  if (days > 7) return null
  if (days > 0) return trialing ? 'trial_ending' : 'period_ending'

  const sinceEnd = -days
  if (sinceEnd === 0) return trialing ? 'trial_over' : 'period_ending'
  if (sinceEnd <= TEAM_PLAN.graceDays) return 'grace'
  return 'locked'
}

const COPY: Record<Stage, (input: { name: string, amount: string, days: number }) => {
  subject: string
  heading: string
  body: string
  action: string
}> = {
  trial_ending: ({ name, amount, days }) => ({
    subject: `${name}: ${days} ${days === 1 ? 'day' : 'days'} left on your Schedra trial`,
    heading: 'Your trial is nearly up',
    body: `${name} has ${days} ${days === 1 ? 'day' : 'days'} left of its free trial. Paying keeps your team booking pages taking bookings — it is ${amount} for the members who have joined.\n\nNothing is charged automatically, so this needs a moment from you.`,
    action: 'Pay and keep the team running'
  }),
  trial_over: ({ name, amount }) => ({
    subject: `${name}: your Schedra trial has ended`,
    heading: 'Your trial has ended',
    body: `${name} is now in its ${TEAM_PLAN.graceDays}-day grace period. Team booking pages are still taking bookings, and paying ${amount} keeps them that way.\n\nNothing has been deleted, and nothing will be.`,
    action: 'Pay now'
  }),
  period_ending: ({ name, amount, days }) => ({
    subject: `${name}: your Schedra invoice is due`,
    heading: 'Time to renew',
    body: `${name} renews in ${Math.max(days, 0)} ${days === 1 ? 'day' : 'days'}, and it is ${amount} for the members who have joined.\n\nBank transfer cannot be charged automatically, so renewals always need a moment from you.`,
    action: 'Pay this invoice'
  }),
  grace: ({ name, amount }) => ({
    subject: `${name}: payment needed to keep taking bookings`,
    heading: 'Payment still outstanding',
    body: `${name} has not been paid for yet. The grace period ends soon, after which team booking pages stop taking new bookings.\n\nEverything is retained either way — bookings, members and exports all stay. Paying ${amount} restores it immediately.`,
    action: 'Pay now'
  }),
  locked: ({ name, amount }) => ({
    subject: `${name} is now read-only`,
    heading: 'Your team is read-only',
    body: `${name} has stopped taking new bookings because its subscription is unpaid.\n\nNothing has been deleted. Every booking, member and export is exactly where you left it, and paying ${amount} brings the team straight back.`,
    action: 'Reactivate the team'
  })
}

async function findDue(now: Date): Promise<Due[]> {
  const db = useDatabase()
  const horizon = new Date(now.getTime() + 8 * DAY_MS)

  const rows = await db
    .select({
      organizationId: organizationSubscriptions.organizationId,
      status: organizationSubscriptions.status,
      interval: organizationSubscriptions.interval,
      trialEndsAt: organizationSubscriptions.trialEndsAt,
      currentPeriodEnd: organizationSubscriptions.currentPeriodEnd,
      name: organizations.name,
      slug: organizations.slug,
      seats: sql<number>`(select count(*) from ${members} where ${members.organizationId} = ${organizationSubscriptions.organizationId})`.mapWith(Number)
    })
    .from(organizationSubscriptions)
    .innerJoin(organizations, eq(organizations.id, organizationSubscriptions.organizationId))
    .where(and(
      // Only the invoice path; Bachs chases its own card subscriptions.
      eq(organizationSubscriptions.collectionMethod, 'invoice'),
      isNull(organizations.archivedAt),
      inArray(organizationSubscriptions.status, ['trialing', 'active', 'past_due']),
      sql`coalesce(${organizationSubscriptions.trialEndsAt}, ${organizationSubscriptions.currentPeriodEnd}) <= ${horizon.toISOString()}::timestamptz`
    ))

  const due: Due[] = []

  for (const row of rows) {
    const stage = stageFor(row, now)
    if (!stage) continue

    const deadline = row.status === 'trialing' ? row.trialEndsAt : row.currentPeriodEnd
    due.push({
      organizationId: row.organizationId,
      name: row.name,
      slug: row.slug,
      stage,
      seats: row.seats,
      interval: row.interval as BillingInterval,
      deadline: deadline!
    })
  }

  return due
}

/**
 * Reminders go to owners only — they are the ones who can act, and a member
 * being chased about a bill they cannot pay is noise.
 */
async function ownersOf(organizationId: string) {
  return useDatabase()
    .select({ email: users.email, name: users.name })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(eq(members.organizationId, organizationId), eq(members.role, 'owner')))
}

export async function processBillingReminders(now = new Date()) {
  if (!useEnv().bachsSecretKey) return { sent: 0, skipped: 'billing-not-configured' as const }

  const env = useEnv()
  const due = await findDue(now)
  let sent = 0

  for (const team of due) {
    const owners = await ownersOf(team.organizationId)
    if (!owners.length) continue

    const amount = formatUsd(invoiceTotalCents(team.seats, team.interval))
    const copy = COPY[team.stage]({
      name: team.name,
      amount,
      days: Math.max(daysBetween(now, team.deadline), 0)
    })
    const url = `${env.schedraUrl}/t/${team.slug}/billing`

    await enqueueEmails(owners.map(owner => ({
      // Keyed by stage and deadline, so a stage is announced once even though
      // the sweep runs many times before it passes.
      dedupeKey: emailDedupeKey(
        'billing-reminder',
        `${team.organizationId}:${team.stage}:${team.deadline.toISOString().slice(0, 10)}:${owner.email}`
      ),
      email: {
        to: owner.email,
        subject: copy.subject,
        preheader: `${team.name} · ${amount}`,
        heading: copy.heading,
        body: copy.body,
        action: { label: copy.action, url },
        footer: 'You are getting this because you own this team on Schedra.'
      }
    })))

    sent += owners.length
  }

  return { sent, teams: due.length }
}

/** Moves lapsed invoice teams to canceled so entitlement stops deriving grace. */
export async function expireLapsedTeams(now = new Date()) {
  const cutoff = new Date(now.getTime() - TEAM_PLAN.graceDays * DAY_MS)

  const updated = await useDatabase()
    .update(organizationSubscriptions)
    .set({ status: 'canceled', updatedAt: sql`now()` })
    .where(and(
      eq(organizationSubscriptions.collectionMethod, 'invoice'),
      inArray(organizationSubscriptions.status, ['trialing', 'active', 'past_due']),
      sql`coalesce(${organizationSubscriptions.trialEndsAt}, ${organizationSubscriptions.currentPeriodEnd}) <= ${cutoff.toISOString()}::timestamptz`
    ))
    .returning({ organizationId: organizationSubscriptions.organizationId })

  return updated.length
}
