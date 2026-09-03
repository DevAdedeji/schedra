import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { configureAppTestEnvironment, getTestDatabaseUrl } from '../../test/helpers/database'

const url = getTestDatabaseUrl()

describe.skipIf(!url)('platform control data', () => {
  const sql = postgres(url!, { max: 3, onnotice: () => {} })
  let ownerId: string
  let memberId: string
  let organizationId: string
  let personalEventId: string
  let teamEventId: string

  beforeEach(async () => {
    configureAppTestEnvironment(url!)
    await sql`truncate table users, organizations restart identity cascade`

    const [owner] = await sql<{ id: string }[]>`
      insert into users (email, name, username, email_verified, time_zone, two_factor_enabled)
      values ('owner@example.com', 'Owner Person', 'owner-person', true, 'Africa/Lagos', true)
      returning id
    `
    const [member] = await sql<{ id: string }[]>`
      insert into users (email, name, username)
      values ('member@example.com', 'Member Person', 'member-person')
      returning id
    `
    ownerId = owner!.id
    memberId = member!.id

    const [organization] = await sql<{ id: string }[]>`
      insert into organizations (name, slug) values ('Control Team', 'control-team') returning id
    `
    organizationId = organization!.id
    const memberRows = await sql<{ id: string, user_id: string }[]>`
      insert into members (organization_id, user_id, role)
      values (${organizationId}, ${ownerId}, 'owner'), (${organizationId}, ${memberId}, 'member')
      returning id, user_id
    `
    const memberRow = memberRows.find(row => row.user_id === memberId)!

    await sql`
      insert into personal_subscriptions (user_id, status, interval)
      values (${ownerId}, 'active', 'yearly')
    `
    await sql`
      insert into organization_subscriptions (organization_id, status, interval)
      values (${organizationId}, 'trialing', 'monthly')
    `
    await sql`
      insert into accounts (user_id, account_id, provider_id)
      values (${ownerId}, 'owner@example.com', 'credential'), (${ownerId}, 'google-owner', 'google')
    `
    await sql`
      insert into calendar_connections (
        user_id, provider, account_label, access_token_encrypted, refresh_token_encrypted,
        access_token_expires_at, scope, status
      ) values (${ownerId}, 'google', 'owner@example.com', 'secret', 'secret', now() + interval '1 hour', 'calendar', 'active')
    `

    const [personalEvent] = await sql<{ id: string }[]>`
      insert into event_types (user_id, slug, title, duration_minutes)
      values (${ownerId}, 'advice', 'Advice call', 30)
      returning id
    `
    const [teamEvent] = await sql<{ id: string }[]>`
      insert into event_types (organization_id, created_by_user_id, slug, title, duration_minutes)
      values (${organizationId}, ${ownerId}, 'team-sync', 'Team sync', 45)
      returning id
    `
    personalEventId = personalEvent!.id
    teamEventId = teamEvent!.id
    await sql`
      insert into event_type_hosts (event_type_id, member_id, user_id)
      values (${teamEventId}, ${memberRow.id}, ${memberId})
    `
    await sql`
      insert into bookings (
        organization_id, event_type_id, host_id, uid, starts_at, ends_at,
        attendee_name, attendee_email, attendee_time_zone
      ) values (
        null, ${personalEventId}, ${ownerId}, 'control-booking', now() + interval '1 day',
        now() + interval '1 day 30 minutes', 'Private Guest', 'private@example.com', 'UTC'
      )
    `
  })

  afterAll(async () => {
    await sql`truncate table users, organizations restart identity cascade`
    await sql.end()
  })

  it('summarizes product usage and active subscriptions', async () => {
    const { controlOverview } = await import('../services/control')
    const result = await controlOverview()

    expect(result.users).toMatchObject({ total: 2, verified: 1, twoFactor: 1 })
    expect(result.organizations).toMatchObject({ total: 1, active: 1 })
    expect(result.eventTypes).toMatchObject({ total: 2, visible: 2 })
    expect(result.bookings).toMatchObject({ total: 1, upcoming: 1 })
    expect(result.subscriptions).toEqual({ personal: 1, teams: 1 })
  })

  it('searches users and returns only safe account metadata', async () => {
    const { controlUsers, controlUserDetail } = await import('../services/control')
    const list = await controlUsers({ page: 1, pageSize: 10, search: 'owner@' })
    expect(list.pagination.total).toBe(1)
    expect(list.items[0]).toMatchObject({
      id: ownerId,
      eventTypeCount: 1,
      bookingCount: 1,
      teamCount: 1,
      subscriptionStatus: 'active',
      providers: ['credential', 'google']
    })

    const detail = await controlUserDetail(ownerId)
    expect(detail).toMatchObject({
      user: { id: ownerId, subscriptionStatus: 'active' },
      counts: { teams: 1, eventTypes: 1, bookings: 1, integrations: 1 }
    })
    expect(detail?.recentBookings[0]).not.toHaveProperty('attendeeEmail')
    expect(detail?.recentBookings[0]).not.toHaveProperty('answers')
    expect(JSON.stringify(detail)).not.toContain('secret')
  })

  it('includes team links hosted by a member without treating them as owned links', async () => {
    const { controlUserDetail } = await import('../services/control')
    const detail = await controlUserDetail(memberId)

    expect(detail?.eventTypes).toEqual([
      expect.objectContaining({ id: teamEventId, scope: 'team', organizationName: 'Control Team' })
    ])
    expect(detail?.counts.eventTypes).toBe(1)
  })

  it('lists event types, teams and bookings with bounded support metadata', async () => {
    const { controlBookings, controlEventTypes, controlOrganizations } = await import('../services/control')
    const [eventList, teamList, bookingList] = await Promise.all([
      controlEventTypes({ page: 1, pageSize: 10, search: 'advice' }),
      controlOrganizations({ page: 1, pageSize: 10, search: 'control' }),
      controlBookings({ page: 1, pageSize: 10, search: 'control-booking' })
    ])

    expect(eventList.items).toEqual([
      expect.objectContaining({ id: personalEventId, ownerEmail: 'owner@example.com', bookingCount: 1 })
    ])
    expect(teamList.items).toEqual([
      expect.objectContaining({ id: organizationId, ownerEmail: 'owner@example.com', memberCount: 2, eventTypeCount: 1 })
    ])
    expect(bookingList.items).toEqual([
      expect.objectContaining({ uid: 'control-booking', hostEmail: 'owner@example.com' })
    ])
    expect(bookingList.items[0]).not.toHaveProperty('attendeeEmail')
  })
})
