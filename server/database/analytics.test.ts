import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { configureAppTestEnvironment, getTestDatabaseUrl } from '../../test/helpers/database'

const url = getTestDatabaseUrl()

describe.skipIf(!url)('booking analytics scoping and aggregation', () => {
  const sql = postgres(url!, { max: 3, onnotice: () => {} })
  let userId: string
  let otherUserId: string
  let personalEventId: string
  let organizationId: string
  let teamEventId: string
  let bookingOffset = 0

  beforeEach(async () => {
    configureAppTestEnvironment(url!)
    bookingOffset = 0
    const { resetEnv } = await import('../config/env')
    resetEnv()
    await sql`truncate table booking_payments, payment_recipients, booking_hosts, bookings, event_types, members, organizations, users restart identity cascade`
    const [user] = await sql<{ id: string }[]>`insert into users (email, name, username) values ('analytics@example.com', 'Analytics Host', 'analytics-host') returning id`
    const [other] = await sql<{ id: string }[]>`insert into users (email, name, username) values ('other-analytics@example.com', 'Other Host', 'other-analytics') returning id`
    userId = user!.id
    otherUserId = other!.id
    const [personal] = await sql<{ id: string }[]>`insert into event_types (user_id, slug, title, duration_minutes) values (${userId}, 'personal', 'Personal call', 30) returning id`
    personalEventId = personal!.id
    const [organization] = await sql<{ id: string }[]>`insert into organizations (name, slug) values ('Analytics Team', 'analytics-team') returning id`
    organizationId = organization!.id
    await sql`insert into members (organization_id, user_id, role) values (${organizationId}, ${userId}, 'member'), (${organizationId}, ${otherUserId}, 'owner')`
    const [teamEvent] = await sql<{ id: string }[]>`insert into event_types (organization_id, created_by_user_id, slug, title, duration_minutes) values (${organizationId}, ${otherUserId}, 'team-call', 'Team call', 30) returning id`
    teamEventId = teamEvent!.id
  })

  afterAll(async () => {
    await sql`truncate table booking_payments, payment_recipients, booking_hosts, bookings, event_types, members, organizations, users restart identity cascade`
    await sql.end()
  })

  async function booking(input: { eventTypeId: string, hostId: string, organizationId?: string, status: string, source: string, uid: string }) {
    const offset = bookingOffset++ * 60
    const [row] = await sql<{ id: string }[]>`
      insert into bookings (
        organization_id, event_type_id, host_id, uid, status, starts_at, ends_at,
        attendee_name, attendee_email, attendee_time_zone, source, created_at
      ) values (
        ${input.organizationId ?? null}, ${input.eventTypeId}, ${input.hostId}, ${input.uid}, ${input.status},
        now() + interval '2 days' + ${offset} * interval '1 minute',
        now() + interval '2 days 30 minutes' + ${offset} * interval '1 minute',
        'Guest', ${`${input.uid}@example.com`}, 'UTC', ${input.source}, now() - interval '2 days'
      ) returning id
    `
    return row!.id
  }

  it('excludes abandoned checkouts and keeps other accounts out of personal analytics', async () => {
    const paidBookingId = await booking({ eventTypeId: personalEventId, hostId: userId, status: 'confirmed', source: 'hosted', uid: 'personal-paid' })
    await booking({ eventTypeId: personalEventId, hostId: userId, status: 'cancelled', source: 'embed', uid: 'personal-cancelled' })
    await booking({ eventTypeId: personalEventId, hostId: userId, status: 'awaiting_payment', source: 'hosted', uid: 'personal-abandoned' })
    const [otherEvent] = await sql<{ id: string }[]>`insert into event_types (user_id, slug, title, duration_minutes) values (${otherUserId}, 'other', 'Other call', 30) returning id`
    await booking({ eventTypeId: otherEvent!.id, hostId: otherUserId, status: 'confirmed', source: 'hosted', uid: 'other-booking' })
    const [recipient] = await sql<{ id: string }[]>`insert into payment_recipients (user_id, bachs_account_id, status) values (${userId}, 'acct_analytics', 'active') returning id`
    await sql`insert into booking_payments (booking_id, recipient_id, reference, status, amount_cents, currency, platform_fee_cents) values (${paidBookingId}, ${recipient!.id}, 'analytics-paid', 'paid', 2500, 'USD', 125)`

    const { getBookingAnalytics } = await import('../services/analytics')
    const result = await getBookingAnalytics({ userId }, { days: 30 })
    expect(result.summary).toMatchObject({ total: 2, confirmed: 1, cancelled: 1, cancellationRate: 50 })
    expect(result.sources).toEqual({ hosted: 1, embed: 1 })
    expect(result.revenue).toEqual([{ currency: 'USD', amountCents: 2500 }])
    expect(result.options.map(option => option.title)).toEqual(['Personal call'])
  })

  it('limits members to assigned team bookings while owners can aggregate the team', async () => {
    await booking({ eventTypeId: teamEventId, hostId: userId, organizationId, status: 'confirmed', source: 'hosted', uid: 'assigned-team' })
    await booking({ eventTypeId: teamEventId, hostId: otherUserId, organizationId, status: 'confirmed', source: 'hosted', uid: 'other-team' })
    const { getBookingAnalytics } = await import('../services/analytics')
    const mine = await getBookingAnalytics({ organizationId, visibleUserId: userId }, { days: 30 })
    const team = await getBookingAnalytics({ organizationId }, { days: 30 })
    expect(mine.summary.total).toBe(1)
    expect(mine.scope).toBe('mine')
    expect(team.summary.total).toBe(2)
    expect(team.scope).toBe('team')
  })
})
