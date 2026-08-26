import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { configureAppTestEnvironment, getTestDatabaseUrl } from '../../test/helpers/database'

const url = getTestDatabaseUrl()

const TABLES = 'organization_audit_logs, organization_slug_history, organization_subscriptions, '
  + 'invitations, members, email_outbox, api_rate_limits, rate_limits, sessions, accounts, '
  + 'verifications, bookings, event_types, date_overrides, availability_rules, schedules, users, organizations'

describe.skipIf(!url)('team workspaces', () => {
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

  async function createWorkspace(headers: Headers, name = 'Acme Design', slug = 'acme') {
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
    const workspace = await createWorkspace(ada.headers)

    expect(workspace?.slug).toBe('acme')

    const [membership] = await sql<{ role: string }[]>`
      select role from members where organization_id = ${workspace!.id} and user_id = ${ada.id}
    `
    expect(membership?.role).toBe('owner')

    const [subscription] = await sql<{ status: string, interval: string, trial_ends_at: Date }[]>`
      select status, interval, trial_ends_at from organization_subscriptions
      where organization_id = ${workspace!.id}
    `
    expect(subscription?.status).toBe('trialing')
    expect(subscription?.interval).toBe('yearly')
    expect(subscription!.trial_ends_at.getTime()).toBeGreaterThan(Date.now())

    const [audit] = await sql<{ action: string }[]>`
      select action from organization_audit_logs where organization_id = ${workspace!.id}
    `
    expect(audit?.action).toBe('organization.created')
  })

  it('refuses a reserved workspace address', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    await expect(createWorkspace(ada.headers, 'Settings', 'settings')).rejects.toThrow()
  })

  it('keeps a retired address reserved so old links cannot be hijacked', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const workspace = await createWorkspace(ada.headers)

    await sql`
      insert into organization_slug_history (organization_id, slug) values (${workspace!.id}, 'retired')
    `

    const grace = await signUp('Grace Hopper', 'grace', 'grace@example.com')
    await expect(createWorkspace(grace.headers, 'Retired', 'retired')).rejects.toThrow()
  })

  it('resolves a renamed workspace by its old address', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const workspace = await createWorkspace(ada.headers)

    await sql`insert into organization_slug_history (organization_id, slug) values (${workspace!.id}, 'acme')`
    await sql`update organizations set slug = 'acme-design' where id = ${workspace!.id}`

    const { findOrganizationBySlug } = await import('../utils/organization')
    const found = await findOrganizationBySlug('acme')

    expect(found?.organization.id).toBe(workspace!.id)
    expect(found?.renamed).toBe(true)
  })

  it('counts only members who joined, and bills a two-seat minimum', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const workspace = await createWorkspace(ada.headers)

    const instance = await auth()
    await instance.api.createInvitation({
      body: { email: 'grace@example.com', role: 'member', organizationId: workspace!.id },
      headers: ada.headers
    })

    const { organizationEntitlement } = await import('../utils/entitlement')
    const entitlement = await organizationEntitlement(workspace!.id)

    // A pending invitation costs nothing until it is accepted.
    expect(entitlement.seatsUsed).toBe(1)
    expect(entitlement.status).toBe('trialing')
    expect(entitlement.nextInvoiceCents).toBe(2 * 8000)
  })

  it('lets an invited person join and records it', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const grace = await signUp('Grace Hopper', 'grace', 'grace@example.com')
    const workspace = await createWorkspace(ada.headers)

    const instance = await auth()
    const invitation = await instance.api.createInvitation({
      body: { email: 'grace@example.com', role: 'admin', organizationId: workspace!.id },
      headers: ada.headers
    })

    await instance.api.acceptInvitation({
      body: { invitationId: invitation!.id },
      headers: grace.headers
    })

    const [membership] = await sql<{ role: string }[]>`
      select role from members where organization_id = ${workspace!.id} and user_id = ${grace.id}
    `
    expect(membership?.role).toBe('admin')

    const actions = await sql<{ action: string }[]>`
      select action from organization_audit_logs where organization_id = ${workspace!.id} order by created_at
    `
    expect(actions.map(row => row.action)).toContain('invitation.accepted')
  })

  it('refuses to let the last owner leave', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const workspace = await createWorkspace(ada.headers)
    const instance = await auth()

    await expect(instance.api.leaveOrganization({
      body: { organizationId: workspace!.id },
      headers: ada.headers
    })).rejects.toThrow()

    const [membership] = await sql<{ role: string }[]>`
      select role from members where organization_id = ${workspace!.id} and user_id = ${ada.id}
    `
    expect(membership?.role).toBe('owner')
  })

  it('treats an expired trial as past due, then read-only after the grace period', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const workspace = await createWorkspace(ada.headers)
    const { organizationEntitlement } = await import('../utils/entitlement')

    await sql`
      update organization_subscriptions set trial_ends_at = now() - interval '1 day'
      where organization_id = ${workspace!.id}
    `
    const justExpired = await organizationEntitlement(workspace!.id)
    expect(justExpired.status).toBe('past_due')
    expect(justExpired.readOnly).toBe(false)
    expect(justExpired.canAddMembers).toBe(false)

    await sql`
      update organization_subscriptions set trial_ends_at = now() - interval '30 days'
      where organization_id = ${workspace!.id}
    `
    const lapsed = await organizationEntitlement(workspace!.id)
    expect(lapsed.status).toBe('past_due')
    expect(lapsed.readOnly).toBe(true)
  })

  it('treats a workspace with no subscription row as expired rather than free', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const workspace = await createWorkspace(ada.headers)

    await sql`delete from organization_subscriptions where organization_id = ${workspace!.id}`

    const { organizationEntitlement } = await import('../utils/entitlement')
    const entitlement = await organizationEntitlement(workspace!.id)

    expect(entitlement.status).toBe('canceled')
    expect(entitlement.readOnly).toBe(true)
    expect(entitlement.canAddMembers).toBe(false)
  })

  it('blocks account deletion while a workspace would be left ownerless', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const workspace = await createWorkspace(ada.headers)
    const { activeWorkspacesOwnedBy } = await import('../utils/organization')

    expect(await activeWorkspacesOwnedBy(ada.id)).toHaveLength(1)

    // Archiving clears the obligation; the workspace no longer needs an owner.
    await sql`update organizations set archived_at = now() where id = ${workspace!.id}`
    expect(await activeWorkspacesOwnedBy(ada.id)).toHaveLength(0)
  })

  it('hands ownership over without ever leaving two owners or none', async () => {
    const ada = await signUp('Ada Lovelace', 'ada', 'ada@example.com')
    const grace = await signUp('Grace Hopper', 'grace', 'grace@example.com')
    const workspace = await createWorkspace(ada.headers)
    const instance = await auth()

    const invitation = await instance.api.createInvitation({
      body: { email: 'grace@example.com', role: 'member', organizationId: workspace!.id },
      headers: ada.headers
    })
    await instance.api.acceptInvitation({
      body: { invitationId: invitation!.id },
      headers: grace.headers
    })

    const [graceMember] = await sql<{ id: string }[]>`
      select id from members where organization_id = ${workspace!.id} and user_id = ${grace.id}
    `

    await sql.begin(async (tx) => {
      await tx`update members set role = 'owner' where id = ${graceMember!.id}`
      await tx`
        update members set role = 'admin'
        where organization_id = ${workspace!.id} and user_id = ${ada.id}
      `
    })

    const roles = await sql<{ role: string }[]>`
      select role from members where organization_id = ${workspace!.id} order by role
    `
    expect(roles.map(row => row.role)).toEqual(['admin', 'owner'])

    const { countMembersWithRole } = await import('../utils/organization')
    expect(await countMembersWithRole(workspace!.id, 'owner')).toBe(1)
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
