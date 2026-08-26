import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { configureAppTestEnvironment, getTestDatabaseUrl } from '../../test/helpers/database'

const url = getTestDatabaseUrl()

const TABLES = 'organization_audit_logs, organization_slug_history, organization_subscriptions, '
  + 'organization_invoices, bachs_webhook_events, booking_hosts, event_type_hosts, invitations, members, email_outbox, api_rate_limits, rate_limits, sessions, accounts, '
  + 'verifications, bookings, event_types, date_overrides, availability_rules, schedules, users, organizations'

describe.skipIf(!url)('teams', () => {
  const sql = postgres(url!, { max: 3, onnotice: () => {} })

  async function auth() {
    configureAppTestEnvironment(url!)
    const { resetEnv } = await import('../utils/env')
    resetEnv()
    const { useAuth } = await import('../utils/auth')
    return useAuth()
  }

  async function signUp(name: string, username: string, email: string) {
    const instance = await auth()
    await instance.api.signUpEmail({
      body: { name, username, email, password: 'a-long-enough-passphrase', timeZone: 'Africa/Lagos' }
    })
    await sql`update users set email_verified = true where email = ${email}`

    const response = await instance.api.signInEmail({
      body: { email, password: 'a-long-enough-passphrase' },
      returnHeaders: true
    })
    const cookie = response.headers.getSetCookie().join('; ')
    const [row] = await sql<{ id: string }[]>`select id from users where email = ${email}`

    return { headers: new Headers({ cookie }), id: row!.id, email }
  }

  async function createTeam(headers: Headers, name = 'Acme Design', slug = 'acme') {
    const instance = await auth()
    return instance.api.createOrganization({ body: { name, slug }, headers })
  }

  afterAll(async () => {
    await sql.unsafe(`truncate table ${TABLES} restart identity cascade`)
    await sql.end()
  })

  beforeEach(async () => {
    await sql.unsafe(`truncate table ${TABLES} restart identity cascade`)
  })

  it('makes the creator an owner and starts a trial', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const team = await createTeam(ada.headers)

    expect(team?.slug).toBe('acme')

    const [membership] = await sql<{ role: string }[]>`
      select role from members where organization_id = ${team!.id} and user_id = ${ada.id}
    `
    expect(membership?.role).toBe('owner')

    const [subscription] = await sql<{ status: string, interval: string, trial_ends_at: Date }[]>`
      select status, interval, trial_ends_at from organization_subscriptions
      where organization_id = ${team!.id}
    `
    expect(subscription?.status).toBe('trialing')
    expect(subscription?.interval).toBe('yearly')
    expect(subscription!.trial_ends_at.getTime()).toBeGreaterThan(Date.now())

    const [audit] = await sql<{ action: string }[]>`
      select action from organization_audit_logs where organization_id = ${team!.id}
    `
    expect(audit?.action).toBe('organization.created')
  })

  it('refuses a reserved team address', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    await expect(createTeam(ada.headers, 'Settings', 'settings')).rejects.toThrow()
  })

  it('keeps a retired address reserved so old links cannot be hijacked', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const team = await createTeam(ada.headers)

    await sql`
      insert into organization_slug_history (organization_id, slug) values (${team!.id}, 'retired')
    `

    const grace = await signUp('Grace Hopper', 'grace', 'grace@example.com')
    await expect(createTeam(grace.headers, 'Retired', 'retired')).rejects.toThrow()
  })

  it('resolves a renamed team by its old address', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const team = await createTeam(ada.headers)

    await sql`insert into organization_slug_history (organization_id, slug) values (${team!.id}, 'acme')`
    await sql`update organizations set slug = 'acme-design' where id = ${team!.id}`

    const { findOrganizationBySlug } = await import('../utils/organization')
    const found = await findOrganizationBySlug('acme')

    expect(found?.organization.id).toBe(team!.id)
    expect(found?.renamed).toBe(true)
  })

  it('counts only members who joined, and bills a two-seat minimum', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const team = await createTeam(ada.headers)

    const instance = await auth()
    await instance.api.createInvitation({
      body: { email: 'grace@example.com', role: 'member', organizationId: team!.id },
      headers: ada.headers
    })

    const { organizationEntitlement } = await import('../utils/entitlement')
    const entitlement = await organizationEntitlement(team!.id)

    // A pending invitation costs nothing until it is accepted.
    expect(entitlement.seatsUsed).toBe(1)
    expect(entitlement.status).toBe('trialing')
    expect(entitlement.nextInvoiceCents).toBe(2 * 8000)
  })

  it('lets an invited person join and records it', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const grace = await signUp('Grace Hopper', 'grace', 'grace@example.com')
    const team = await createTeam(ada.headers)

    const instance = await auth()
    const invitation = await instance.api.createInvitation({
      body: { email: 'grace@example.com', role: 'admin', organizationId: team!.id },
      headers: ada.headers
    })

    await instance.api.acceptInvitation({
      body: { invitationId: invitation!.id },
      headers: grace.headers
    })

    const [membership] = await sql<{ role: string }[]>`
      select role from members where organization_id = ${team!.id} and user_id = ${grace.id}
    `
    expect(membership?.role).toBe('admin')

    const actions = await sql<{ action: string }[]>`
      select action from organization_audit_logs where organization_id = ${team!.id} order by created_at
    `
    expect(actions.map(row => row.action)).toContain('invitation.accepted')
  })

  it('refuses to let the last owner leave', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const team = await createTeam(ada.headers)
    const instance = await auth()

    await expect(instance.api.leaveOrganization({
      body: { organizationId: team!.id },
      headers: ada.headers
    })).rejects.toThrow()

    const [membership] = await sql<{ role: string }[]>`
      select role from members where organization_id = ${team!.id} and user_id = ${ada.id}
    `
    expect(membership?.role).toBe('owner')
  })

  it('treats an expired trial as past due, then read-only after the grace period', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const team = await createTeam(ada.headers)
    const { organizationEntitlement } = await import('../utils/entitlement')

    await sql`
      update organization_subscriptions set trial_ends_at = now() - interval '1 day'
      where organization_id = ${team!.id}
    `
    const justExpired = await organizationEntitlement(team!.id)
    expect(justExpired.status).toBe('past_due')
    expect(justExpired.readOnly).toBe(false)
    expect(justExpired.canAddMembers).toBe(false)

    await sql`
      update organization_subscriptions set trial_ends_at = now() - interval '30 days'
      where organization_id = ${team!.id}
    `
    const lapsed = await organizationEntitlement(team!.id)
    expect(lapsed.status).toBe('past_due')
    expect(lapsed.readOnly).toBe(true)
  })

  it('treats a team with no subscription row as expired rather than free', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const team = await createTeam(ada.headers)

    await sql`delete from organization_subscriptions where organization_id = ${team!.id}`

    const { organizationEntitlement } = await import('../utils/entitlement')
    const entitlement = await organizationEntitlement(team!.id)

    expect(entitlement.status).toBe('canceled')
    expect(entitlement.readOnly).toBe(true)
    expect(entitlement.canAddMembers).toBe(false)
  })

  it('blocks account deletion while a team would be left ownerless', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const team = await createTeam(ada.headers)
    const { activeTeamsOwnedBy } = await import('../utils/organization')

    expect(await activeTeamsOwnedBy(ada.id)).toHaveLength(1)

    // Archiving clears the obligation; the team no longer needs an owner.
    await sql`update organizations set archived_at = now() where id = ${team!.id}`
    expect(await activeTeamsOwnedBy(ada.id)).toHaveLength(0)
  })

  it('hands ownership over without ever leaving two owners or none', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const grace = await signUp('Grace Hopper', 'grace', 'grace@example.com')
    const team = await createTeam(ada.headers)
    const instance = await auth()

    const invitation = await instance.api.createInvitation({
      body: { email: 'grace@example.com', role: 'member', organizationId: team!.id },
      headers: ada.headers
    })
    await instance.api.acceptInvitation({
      body: { invitationId: invitation!.id },
      headers: grace.headers
    })

    const [graceMember] = await sql<{ id: string }[]>`
      select id from members where organization_id = ${team!.id} and user_id = ${grace.id}
    `

    await sql.begin(async (tx) => {
      await tx`update members set role = 'owner' where id = ${graceMember!.id}`
      await tx`
        update members set role = 'admin'
        where organization_id = ${team!.id} and user_id = ${ada.id}
      `
    })

    const roles = await sql<{ role: string }[]>`
      select role from members where organization_id = ${team!.id} order by role
    `
    expect(roles.map(row => row.role)).toEqual(['admin', 'owner'])

    const { countMembersWithRole } = await import('../utils/organization')
    expect(await countMembersWithRole(team!.id, 'owner')).toBe(1)
  })

  it('applies a payment once even when the webhook and redirect race', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const team = await createTeam(ada.headers)
    const { markInvoicePaid } = await import('../utils/billing')
    const { organizationEntitlement } = await import('../utils/entitlement')

    const reference = 'schedra-team-test-reference'
    await sql`
      insert into organization_invoices
        (organization_id, reference, status, interval, seats, amount_cents, period_start, period_end)
      values
        (${team!.id}, ${reference}, 'pending', 'yearly', 2, 16000, now(), now() + interval '1 year')
    `

    // Both deliveries arrive at once, which is the normal case, not the edge.
    const [first, second] = await Promise.all([
      markInvoicePaid({ reference, chargeId: 'chr_1', settlementAmountCents: 15800 }),
      markInvoicePaid({ reference, chargeId: 'chr_1', settlementAmountCents: 15800 })
    ])

    expect([first.applied, second.applied].filter(Boolean)).toHaveLength(1)

    const rows = await sql<{ status: string, settlement_amount_cents: number }[]>`
      select status, settlement_amount_cents from organization_invoices where reference = ${reference}
    `
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('paid')
    // The settlement amount is credited, never the gross charge.
    expect(rows[0]!.settlement_amount_cents).toBe(15800)

    const entitlement = await organizationEntitlement(team!.id)
    expect(entitlement.status).toBe('active')
    expect(entitlement.readOnly).toBe(false)
  })

  it('ignores a payment for a reference it does not know', async () => {
    const { markInvoicePaid } = await import('../utils/billing')
    const result = await markInvoicePaid({ reference: 'not-a-real-reference' })

    expect(result.applied).toBe(false)
    expect(result.reason).toBe('unknown-reference')
  })

  it('refuses a host who is not in the team, or a schedule that is not theirs', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const grace = await signUp('Grace Hopper', 'grace', 'grace@example.com')
    const team = await createTeam(ada.headers)
    const { resolveHosts } = await import('../utils/team-event-types')

    const [adaMember] = await sql<{ id: string }[]>`
      select id from members where organization_id = ${team!.id} and user_id = ${ada.id}
    `

    // Grace has an account and a starter schedule, but never joined the team.
    const [graceSchedule] = await sql<{ id: string }[]>`
      select id from schedules where user_id = ${grace.id} limit 1
    `
    const [adaSchedule] = await sql<{ id: string }[]>`
      select id from schedules where user_id = ${ada.id} limit 1
    `

    const outsider = { memberId: crypto.randomUUID(), scheduleId: null, enabled: true, weight: 100 }
    await expect(resolveHosts(team!.id, [outsider])).rejects.toThrow()

    // Ada is a member, but the schedule she pinned belongs to Grace.
    await expect(resolveHosts(team!.id, [
      { memberId: adaMember!.id, scheduleId: graceSchedule!.id, enabled: true, weight: 100 }
    ])).rejects.toThrow()

    const allowed = await resolveHosts(team!.id, [
      { memberId: adaMember!.id, scheduleId: adaSchedule!.id, enabled: true, weight: 100 }
    ])
    expect(allowed).toHaveLength(1)
    expect(allowed[0]!.userId).toBe(ada.id)
  })

  it('drops someone as a host the moment they leave the team', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const grace = await signUp('Grace Hopper', 'grace', 'grace@example.com')
    const team = await createTeam(ada.headers)
    const instance = await auth()

    const invitation = await instance.api.createInvitation({
      body: { email: 'grace@example.com', role: 'member', organizationId: team!.id },
      headers: ada.headers
    })
    await instance.api.acceptInvitation({ body: { invitationId: invitation!.id }, headers: grace.headers })

    const [graceMember] = await sql<{ id: string }[]>`
      select id from members where organization_id = ${team!.id} and user_id = ${grace.id}
    `
    const [eventType] = await sql<{ id: string }[]>`
      insert into event_types (organization_id, user_id, slug, title, duration_minutes, assignment_mode)
      values (${team!.id}, ${ada.id}, 'team-intro', 'Team intro', 30, 'round_robin')
      returning id
    `
    await sql`
      insert into event_type_hosts (event_type_id, member_id, user_id)
      values (${eventType!.id}, ${graceMember!.id}, ${grace.id})
    `

    expect(await sql`select id from event_type_hosts where event_type_id = ${eventType!.id}`).toHaveLength(1)

    await instance.api.removeMember({
      body: { memberIdOrEmail: graceMember!.id, organizationId: team!.id },
      headers: ada.headers
    })

    // The event survives; the departed member simply stops being assignable.
    expect(await sql`select id from event_type_hosts where event_type_id = ${eventType!.id}`).toHaveLength(0)
    expect(await sql`select id from event_types where id = ${eventType!.id}`).toHaveLength(1)
  })

  it('scopes an event type slug to its owner, not globally', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const team = await createTeam(ada.headers)

    // Ada already has a personal '30min' from onboarding; the team may reuse it.
    await sql`
      insert into event_types (organization_id, user_id, slug, title, duration_minutes)
      values (${team!.id}, ${ada.id}, '30min', 'Team 30 min', 30)
    `

    const rows = await sql<{ slug: string }[]>`select slug from event_types where slug = '30min'`
    expect(rows).toHaveLength(2)

    // But the same team cannot have two.
    await expect(sql`
      insert into event_types (organization_id, user_id, slug, title, duration_minutes)
      values (${team!.id}, ${ada.id}, '30min', 'Duplicate', 30)
    `).rejects.toThrow()
  })

  it('lets Bachs own the lifecycle once a card subscription exists', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const team = await createTeam(ada.headers)
    const { applySubscriptionState } = await import('../utils/billing')
    const { organizationEntitlement } = await import('../utils/entitlement')

    const applied = await applySubscriptionState({
      id: 'sub_test_1',
      status: 'active',
      quantity: 4,
      current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      cancel_at_period_end: false,
      metadata: { organizationId: team!.id }
    })
    expect(applied.applied).toBe(true)

    const active = await organizationEntitlement(team!.id)
    expect(active.status).toBe('active')
    expect(active.autoRenews).toBe(true)
    expect(active.readOnly).toBe(false)

    // past_due keeps access: Bachs is still retrying the card.
    await applySubscriptionState({
      id: 'sub_test_1', status: 'past_due', metadata: { organizationId: team!.id }
    })
    const retrying = await organizationEntitlement(team!.id)
    expect(retrying.status).toBe('past_due')
    expect(retrying.readOnly).toBe(false)

    // unpaid means retries are exhausted, which is where access stops.
    await applySubscriptionState({
      id: 'sub_test_1', status: 'unpaid', metadata: { organizationId: team!.id }
    })
    const exhausted = await organizationEntitlement(team!.id)
    expect(exhausted.status).toBe('unpaid')
    expect(exhausted.readOnly).toBe(true)
    expect(exhausted.canAddMembers).toBe(false)
  })

  it('ignores a subscription event that carries no team', async () => {
    const { applySubscriptionState } = await import('../utils/billing')
    const result = await applySubscriptionState({ id: 'sub_orphan', status: 'active' })
    expect(result.applied).toBe(false)
    expect(result.reason).toBe('no-organization')
  })

  it('picks the collection method from the currency', async () => {
    const { collectionMethodFor } = await import('#shared/billing')
    // Bachs subscriptions are USD-only, and only a saved card auto-charges.
    expect(collectionMethodFor('USD')).toBe('charge_automatically')
    expect(collectionMethodFor('NGN')).toBe('invoice')
  })

  it('reserves a host automatically and releases them on cancellation', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const [eventType] = await sql<{ id: string }[]>`
      select id from event_types where user_id = ${ada.id} limit 1
    `

    const [booking] = await sql<{ id: string }[]>`
      insert into bookings (event_type_id, host_id, uid, starts_at, ends_at,
                            attendee_name, attendee_email, attendee_time_zone)
      values (${eventType!.id}, ${ada.id}, 'uid-1', now() + interval '2 days',
              now() + interval '2 days 30 minutes', 'Guest', 'guest@example.com', 'UTC')
      returning id
    `

    // The trigger reserved the host without the booking code doing anything.
    const held = await sql<{ is_organizer: boolean, released_at: Date | null }[]>`
      select is_organizer, released_at from booking_hosts where booking_id = ${booking!.id}
    `
    expect(held).toHaveLength(1)
    expect(held[0]!.is_organizer).toBe(true)
    expect(held[0]!.released_at).toBeNull()

    await sql`update bookings set status = 'cancelled' where id = ${booking!.id}`
    const [released] = await sql<{ released_at: Date | null }[]>`
      select released_at from booking_hosts where booking_id = ${booking!.id}
    `
    expect(released!.released_at).not.toBeNull()
  })

  it('refuses to double-book a host, across personal and team meetings alike', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const team = await createTeam(ada.headers)
    const [personal] = await sql<{ id: string }[]>`
      select id from event_types where user_id = ${ada.id} limit 1
    `
    const [teamEvent] = await sql<{ id: string }[]>`
      insert into event_types (organization_id, user_id, slug, title, duration_minutes, assignment_mode)
      values (${team!.id}, ${ada.id}, 'collective', 'Collective', 30, 'collective')
      returning id
    `

    const start = new Date(Date.now() + 3 * 86_400_000)
    const end = new Date(start.getTime() + 30 * 60_000)

    await sql`
      insert into bookings (event_type_id, host_id, uid, starts_at, ends_at,
                            attendee_name, attendee_email, attendee_time_zone)
      values (${personal!.id}, ${ada.id}, 'uid-personal', ${start}, ${end}, 'Guest', 'g@example.com', 'UTC')
    `

    // A team meeting landing on Ada's personal booking must be rejected by the
    // database, not merely avoided by the availability query.
    const [teamBooking] = await sql<{ id: string }[]>`
      insert into bookings (organization_id, event_type_id, host_id, uid, starts_at, ends_at,
                            attendee_name, attendee_email, attendee_time_zone)
      values (${team!.id}, ${teamEvent!.id}, ${ada.id}, 'uid-team',
              ${new Date(start.getTime() + 4 * 86_400_000)},
              ${new Date(end.getTime() + 4 * 86_400_000)}, 'Guest', 'g2@example.com', 'UTC')
      returning id
    `

    await expect(sql`
      insert into booking_hosts (booking_id, user_id, starts_at, ends_at)
      values (${teamBooking!.id}, ${ada.id}, ${start}, ${end})
    `).rejects.toThrow()

    // Back-to-back is fine: a meeting ending exactly when another starts.
    const [adjacent] = await sql<{ id: string }[]>`
      insert into bookings (event_type_id, host_id, uid, starts_at, ends_at,
                            attendee_name, attendee_email, attendee_time_zone)
      values (${personal!.id}, ${ada.id}, 'uid-adjacent', ${end},
              ${new Date(end.getTime() + 30 * 60_000)}, 'Guest', 'g3@example.com', 'UTC')
      returning id
    `
    expect(adjacent!.id).toBeTruthy()
  })

  it('frees the slot again once a booking is cancelled', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const [eventType] = await sql<{ id: string }[]>`
      select id from event_types where user_id = ${ada.id} limit 1
    `
    const start = new Date(Date.now() + 5 * 86_400_000)
    const end = new Date(start.getTime() + 30 * 60_000)

    const [first] = await sql<{ id: string }[]>`
      insert into bookings (event_type_id, host_id, uid, starts_at, ends_at,
                            attendee_name, attendee_email, attendee_time_zone)
      values (${eventType!.id}, ${ada.id}, 'uid-a', ${start}, ${end}, 'A', 'a@example.com', 'UTC')
      returning id
    `

    await sql`update bookings set status = 'cancelled' where id = ${first!.id}`

    // Same host, same time — allowed now the first reservation is released.
    await expect(sql`
      insert into bookings (event_type_id, host_id, uid, starts_at, ends_at,
                            attendee_name, attendee_email, attendee_time_zone)
      values (${eventType!.id}, ${ada.id}, 'uid-b', ${start}, ${end}, 'B', 'b@example.com', 'UTC')
    `).resolves.toBeDefined()
  })

  it('reminds only teams that pay by invoice, and only their owners', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const team = await createTeam(ada.headers)
    // The sweep is deliberately inert when billing is not configured, so a
    // self-hosted deployment never nags anybody about a bill.
    process.env.BACHS_SECRET_KEY = 'sk_sandbox_test'
    process.env.BACHS_WEBHOOK_SECRET = 'whsec-test'
    const { resetEnv } = await import('../utils/env')
    resetEnv()
    const { processBillingReminders } = await import('../utils/billing-reminders')

    // A card subscription is chased by Bachs, so it must not be emailed.
    await sql`
      update organization_subscriptions
      set collection_method = 'charge_automatically', trial_ends_at = now() + interval '2 days'
      where organization_id = ${team!.id}
    `
    expect((await processBillingReminders()).sent).toBe(0)

    await sql`
      update organization_subscriptions
      set collection_method = 'invoice', trial_ends_at = now() + interval '2 days'
      where organization_id = ${team!.id}
    `
    const first = await processBillingReminders()
    expect(first.sent).toBe(1)

    const queued = await sql<{ subject: string }[]>`
      select subject from email_outbox where recipient = 'ada@example.com'
    `
    expect(queued.some(row => row.subject.includes('trial'))).toBe(true)

    // Running again in the same stage must not send a second copy.
    const second = await processBillingReminders()
    expect(second.sent).toBe(1)
    const total = await sql<{ count: number }[]>`
      select count(*)::int as count from email_outbox where recipient = 'ada@example.com'
        and subject like '%trial%'
    `
    expect(total[0]!.count).toBe(1)
  })

  it('locks an invoice team only after the grace period', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const team = await createTeam(ada.headers)
    const { expireLapsedTeams } = await import('../utils/billing-reminders')

    await sql`
      update organization_subscriptions
      set collection_method = 'invoice', trial_ends_at = now() - interval '3 days'
      where organization_id = ${team!.id}
    `
    expect(await expireLapsedTeams()).toBe(0)

    await sql`
      update organization_subscriptions
      set trial_ends_at = now() - interval '30 days'
      where organization_id = ${team!.id}
    `
    expect(await expireLapsedTeams()).toBe(1)

    const [row] = await sql<{ status: string }[]>`
      select status from organization_subscriptions where organization_id = ${team!.id}
    `
    expect(row!.status).toBe('canceled')
  })

  it('gives owners more than admins, and members nothing', async () => {
    const { assertPermission } = await import('../utils/organization')

    expect(() => assertPermission('owner', { billing: ['manage'] })).not.toThrow()
    expect(() => assertPermission('owner', { ownership: ['transfer'] })).not.toThrow()
    expect(() => assertPermission('owner', { organization: ['delete'] })).not.toThrow()

    expect(() => assertPermission('admin', { invitation: ['create'] })).not.toThrow()
    expect(() => assertPermission('admin', { billing: ['manage'] })).toThrow()
    expect(() => assertPermission('admin', { ownership: ['transfer'] })).toThrow()
    expect(() => assertPermission('admin', { organization: ['delete'] })).toThrow()
    expect(() => assertPermission('admin', { slug: ['update'] })).toThrow()

    expect(() => assertPermission('member', { invitation: ['create'] })).toThrow()
    expect(() => assertPermission('member', { member: ['delete'] })).toThrow()
  })
})
