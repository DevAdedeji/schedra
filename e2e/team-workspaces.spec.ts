import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import postgres from 'postgres'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for Playwright tests.')

const sql = postgres(databaseUrl, { max: 2, onnotice: () => {} })
const password = 'a-production-grade-passphrase'

test.beforeEach(async () => {
  await sql`
    truncate table
      worker_leases, worker_instances, operations_alerts, webhook_deliveries,
      subscription_seat_sync_jobs,
      organization_audit_logs, organization_slug_history, organization_invoices,
      organization_subscriptions, booking_hosts, event_type_hosts, invitations,
      members, calendar_sync_jobs, booking_calendar_events, calendar_connections,
      email_outbox, api_rate_limits, rate_limits, sessions, accounts,
      verifications, bookings, event_types, date_overrides,
      availability_rules, schedules, users, organizations
    restart identity cascade
  `
})

test.afterAll(async () => {
  await sql.end()
})

async function signUpAndSignIn(page: Page, account: {
  name: string
  username: string
  email: string
}) {
  await page.goto('/signup')
  await expect(page.getByTestId('signup-form')).toHaveAttribute('data-ready', 'true')
  await page.getByLabel('Your name').fill(account.name)
  await page.getByLabel('Your booking link').fill(account.username)
  await page.getByLabel('Email').fill(account.email)
  await page.locator('input[name="password"]').fill(password)
  await expect(page.getByText('Available', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Create my link' }).click()
  await expect(page).toHaveURL(/\/verify-email/)

  await sql`update users set email_verified = true where email = ${account.email}`
  await signIn(page, account.email)
}

async function signIn(page: Page, email: string, next = '/dashboard') {
  const query = new URLSearchParams({ next, email })
  await page.goto(`/login?${query}`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await expect(page.getByLabel('Email')).toHaveValue(email)
  await expect(page.locator('input[name="password"]')).toHaveValue(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
}

async function signOutLocally(page: Page) {
  await page.context().clearCookies()
}

async function createTeam(page: Page, name: string, slug: string) {
  await page.getByRole('button', { name: /Current team: Personal\. Switch team/ }).click()
  await page.getByText('Create team', { exact: true }).click()
  await page.getByLabel('Team name').fill(name)
  await page.getByLabel('Team address').fill(slug)
  await expect(page.getByRole('button', { name: 'Create team', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Create team', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/t/${slug}/members$`))
  await expect(page.getByRole('heading', { name })).toBeVisible()
}

async function invite(page: Page, email: string, role: 'admin' | 'member' = 'member') {
  await page.getByRole('button', { name: 'Invite', exact: true }).click()
  await page.getByLabel('Email address').fill(email)

  if (role === 'admin') {
    await page.getByRole('button', { name: 'Role' }).click()
    await page.getByText('Admin', { exact: true }).last().click()
  }

  await page.getByRole('button', { name: 'Send invitation' }).click()
  await expect(page.getByText('Pending invitations')).toBeVisible()
  await expect(page.getByText(email, { exact: true })).toBeVisible()

  const [record] = await sql<{ id: string }[]>`
    select id from invitations where email = ${email} order by created_at desc limit 1
  `
  expect(record?.id).toBeTruthy()
  return record!.id
}

test('creates a team, invites an existing admin and completes a shared booking', async ({ page }) => {
  test.setTimeout(60_000)
  await signUpAndSignIn(page, {
    name: 'Grace Hopper',
    username: 'grace-team-host',
    email: 'grace-team-host@schedra.test'
  })
  await signOutLocally(page)

  await signUpAndSignIn(page, {
    name: 'Ada Lovelace',
    username: 'ada-team-owner',
    email: 'ada-team-owner@schedra.test'
  })
  await createTeam(page, 'Quality Labs', 'quality-labs')

  const invitationId = await invite(page, 'grace-team-host@schedra.test', 'admin')
  await signOutLocally(page)
  await signIn(page, 'grace-team-host@schedra.test', `/invite/${invitationId}`)

  await expect(page.getByRole('heading', { name: 'Join Quality Labs' })).toBeVisible()
  await page.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(page).toHaveURL(/\/t\/quality-labs\/members$/)
  await expect(page.getByText('admin', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: /Current team: Quality Labs\. Switch team/ }).click()
  await page.getByText('Personal', { exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await page.getByRole('button', { name: /Current team: Personal\. Switch team/ }).click()
  await page.getByText('Quality Labs', { exact: true }).click()
  await expect(page).toHaveURL(/\/t\/quality-labs\/members$/)

  await page.getByRole('link', { name: 'Event types', exact: true }).click()
  await expect(page).toHaveURL(/\/t\/quality-labs\/event-types$/)
  await page.getByRole('button', { name: 'New event type' }).first().click()
  await page.getByLabel('Title').fill('Architecture review')
  await page.getByLabel('Description').fill('A shared review with the engineering team.')

  await page.getByRole('checkbox', { name: 'Ada Lovelace as host' }).check()
  await page.getByRole('checkbox', { name: 'Grace Hopper as host' }).check()
  await page.getByRole('button', { name: 'Create', exact: true }).click()

  const eventRow = page.getByRole('listitem').filter({ hasText: 'Architecture review' })
  await expect(eventRow).toContainText('Ada Lovelace')
  await expect(eventRow).toContainText('Grace Hopper')

  await page.goto('/team/quality-labs')
  await expect(page.getByRole('heading', { name: 'Quality Labs' })).toBeVisible()
  await page.getByText('Architecture review', { exact: true }).click()
  await page.waitForLoadState('networkidle')
  await page.getByTestId('booking-slot').first().click()
  await page.getByLabel('Your name').fill('E2E Team Guest')
  await page.getByLabel('Email').fill('workspace-guest@schedra.test')
  await page.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(page.getByTestId('booking-confirmation')).toContainText('You\'re booked')

  await page.goto('/t/quality-labs/bookings')
  await expect(page.getByText('Architecture review', { exact: true })).toBeVisible()
  await expect(page.getByText(/E2E Team Guest/)).toBeVisible()

  await page.getByRole('link', { name: 'Activity log', exact: true }).click()
  await expect(page).toHaveURL(/\/t\/quality-labs\/history$/)
  await expect(page.getByRole('heading', { name: 'Activity log' })).toBeVisible()
  await expect(page.getByText('created an event type')).toBeVisible()

  const [booking] = await sql<{ organizationId: string, hostCount: number }[]>`
    select b.organization_id as "organizationId", count(bh.id)::int as "hostCount"
    from bookings b
    join booking_hosts bh on bh.booking_id = b.id
    where b.attendee_email = 'workspace-guest@schedra.test'
    group by b.id
  `
  expect(booking?.organizationId).toBeTruthy()
  expect(booking?.hostCount).toBe(1)
})

test('guides an invited new user through account creation without exposing owner controls', async ({ page }) => {
  await signUpAndSignIn(page, {
    name: 'Workspace Owner',
    username: 'workspace-owner',
    email: 'workspace-owner@schedra.test'
  })
  await createTeam(page, 'Newcomer Studio', 'newcomer-studio')
  const invitationId = await invite(page, 'new-member@schedra.test')

  await page.goto(`/invite/${invitationId}`)
  await expect(page.getByText(/this invitation is for new-member@schedra\.test/i)).toBeVisible()

  await signOutLocally(page)
  await page.goto(`/invite/${invitationId}`)
  await page.getByRole('link', { name: 'Create account to join' }).click()
  await expect(page.getByRole('heading', { name: 'Join Newcomer Studio.' })).toBeVisible()
  await expect(page.getByTestId('signup-form')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByLabel('Email')).toHaveValue('new-member@schedra.test')
  await expect(page.getByLabel('Email')).toBeDisabled()

  await page.getByLabel('Your name').fill('New Team Member')
  await page.getByLabel('Your booking link').fill('new-team-member')
  await page.locator('input[name="password"]').fill(password)
  await expect(page.getByText('Available', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Create my link' }).click()
  await expect(page).toHaveURL(/\/verify-email/)

  await sql`update users set email_verified = true where email = 'new-member@schedra.test'`
  await signIn(page, 'new-member@schedra.test', `/invite/${invitationId}`)
  await page.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(page).toHaveURL(/\/t\/newcomer-studio\/members$/)
  await expect(page.getByRole('main').getByText('New Team Member', { exact: true })).toBeVisible()
  await expect(page.getByText('member', { exact: true })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open navigation and account menu' }).click()
  await expect(page.getByRole('menuitem', { name: 'Members' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Personal' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Newcomer Studio' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.goto('/t/newcomer-studio/event-types')
  await expect(page.getByRole('button', { name: 'New event type' })).toHaveCount(0)
  await page.goto('/new-team-member')
  await expect(page.getByRole('heading', { name: 'New Team Member' })).toBeVisible()

  const [membership] = await sql<{ role: string }[]>`
    select m.role
    from members m
    join users u on u.id = m.user_id
    join organizations o on o.id = m.organization_id
    where u.email = 'new-member@schedra.test' and o.slug = 'newcomer-studio'
  `
  expect(membership?.role).toBe('member')
})

test('manages synchronized member links and scopes team analytics exports', async ({ page }) => {
  test.setTimeout(180_000)
  const memberEmail = 'managed-member@schedra.test'
  const ownerEmail = 'managed-owner@schedra.test'
  const accountCookies = new Map<string, Awaited<ReturnType<BrowserContext['cookies']>>>()
  async function switchAccount(email: string, next: string) {
    await signOutLocally(page)
    const cookies = accountCookies.get(email)
    if (!cookies) throw new Error(`No browser session was saved for ${email}.`)
    await page.context().addCookies(cookies)
    await page.goto(next)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(new RegExp(`${next.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
  }

  await signUpAndSignIn(page, {
    name: 'Managed Member', username: 'managed-member', email: memberEmail
  })
  accountCookies.set(memberEmail, await page.context().cookies())
  await signOutLocally(page)
  await signUpAndSignIn(page, {
    name: 'Managed Owner', username: 'managed-owner', email: ownerEmail
  })
  await createTeam(page, 'Managed Studio', 'managed-studio')
  const invitationId = await invite(page, memberEmail)
  accountCookies.set(ownerEmail, await page.context().cookies())

  await switchAccount(memberEmail, `/invite/${invitationId}`)
  await page.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(page).toHaveURL(/\/t\/managed-studio\/members$/)
  accountCookies.set(memberEmail, await page.context().cookies())

  const [ownerUser] = await sql<{ id: string }[]>`select id from users where email = ${ownerEmail}`
  const [memberUser] = await sql<{ id: string }[]>`select id from users where email = ${memberEmail}`
  const [organizationRow] = await sql<{ id: string }[]>`select id from organizations where slug = 'managed-studio'`
  const [ownerMember] = await sql<{ id: string }[]>`
    select id from members where organization_id = ${organizationRow!.id} and user_id = ${ownerUser!.id}
  `
  const [sourceEvent] = await sql<{ id: string }[]>`
    insert into event_types (
      organization_id, created_by_user_id, user_id, slug, title, description,
      duration_minutes, location_type, location_details, reminder_minutes, assignment_mode, hidden
    ) values (
      ${organizationRow!.id}, ${ownerUser!.id}, null, 'discovery-call', 'Discovery call',
      'Approved team description', 30, 'custom', 'Details follow after booking.',
      '[1440,60]'::jsonb, 'single', false
    ) returning id
  `
  await sql`
    insert into event_type_hosts (event_type_id, member_id, user_id, enabled, position, weight)
    values (${sourceEvent!.id}, ${ownerMember!.id}, ${ownerUser!.id}, true, 0, 100)
  `

  await switchAccount(ownerEmail, '/t/managed-studio/event-types')
  await expect(page.getByText('Discovery call', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: 'New template' }).click()
  const templateDialog = page.getByRole('dialog', { name: 'New managed template' })
  await templateDialog.getByLabel('Template name').fill('Managed discovery')
  await templateDialog.getByLabel('Copy defaults from').click()
  await page.getByText(/Discovery call · 30 min/).last().click()
  await templateDialog.getByRole('checkbox', { name: 'Assign Managed Member' }).check()
  await templateDialog.getByRole('checkbox', { name: 'Allow members to edit Description' }).check()
  await templateDialog.getByRole('button', { name: 'Create template' }).click()
  await expect(page.getByText('1 managed link', { exact: true })).toBeVisible()

  const [managed] = await sql<{
    templateId: string
    eventTypeId: string
    sourceEventTypeId: string
    slug: string
    durationMinutes: number
  }[]>`
    select
      a.template_id as "templateId",
      a.event_type_id as "eventTypeId",
      t.source_event_type_id as "sourceEventTypeId",
      e.slug,
      e.duration_minutes as "durationMinutes"
    from organization_event_template_assignments a
    join organization_event_templates t on t.id = a.template_id
    join event_types e on e.id = a.event_type_id
    join organizations o on o.id = a.organization_id
    where o.slug = 'managed-studio'
  `
  expect(managed).toMatchObject({ slug: 'discovery-call-managed-member', durationMinutes: 30 })
  await expect(page.getByText('Managed · Managed discovery', { exact: true })).toBeVisible()

  await switchAccount(memberEmail, '/t/managed-studio/event-types')
  const managedRow = page.getByRole('listitem').filter({ hasText: 'Managed · Managed discovery' })
  await managedRow.getByRole('button', { name: 'Actions for Discovery call' }).click()
  await page.getByText('Personalize', { exact: true }).click()
  const personalizeDialog = page.getByRole('dialog', { name: 'Personalize managed link' })
  await personalizeDialog.getByLabel('Description').fill('My personal introduction')
  await personalizeDialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Managed link personalized', { exact: true })).toBeVisible()

  const detailResponse = await page.request.get(`/api/teams/managed-studio/event-types/${managed!.eventTypeId}`)
  expect(detailResponse.ok()).toBe(true)
  const detail = await detailResponse.json() as Record<string, unknown>
  const lockedAttempt = await page.request.patch(`/api/teams/managed-studio/event-types/${managed!.eventTypeId}`, {
    data: { ...detail, title: 'Member changed title', durationMinutes: 90, description: 'Allowed API update' }
  })
  expect(lockedAttempt.ok()).toBe(true)
  const [afterMemberEdit] = await sql<{ title: string, durationMinutes: number, description: string }[]>`
    select title, duration_minutes as "durationMinutes", description
    from event_types where id = ${managed!.eventTypeId}
  `
  expect(afterMemberEdit).toEqual({
    title: 'Discovery call', durationMinutes: 30, description: 'Allowed API update'
  })

  await sql`
    update event_types
    set title = 'Qualification call', duration_minutes = 45, description = 'Updated admin description'
    where id = ${managed!.sourceEventTypeId}
  `
  await switchAccount(ownerEmail, '/t/managed-studio/event-types')
  await page.getByRole('button', { name: 'Edit Managed discovery' }).click()
  const editTemplate = page.getByRole('dialog', { name: 'Edit managed template' })
  await editTemplate.getByRole('button', { name: 'Save template' }).click()
  await expect(editTemplate).toBeHidden()
  const [afterSync] = await sql<{ title: string, durationMinutes: number, description: string }[]>`
    select title, duration_minutes as "durationMinutes", description
    from event_types where id = ${managed!.eventTypeId}
  `
  expect(afterSync).toEqual({
    title: 'Qualification call', durationMinutes: 45, description: 'Allowed API update'
  })

  await sql`
    insert into bookings (
      organization_id, event_type_id, host_id, uid, status, starts_at, ends_at,
      attendee_name, attendee_email, attendee_time_zone, source, created_at
    ) values
      (${organizationRow!.id}, ${managed!.eventTypeId}, ${memberUser!.id}, ${crypto.randomUUID()}, 'confirmed', now() + interval '1 day', now() + interval '1 day 45 minutes', 'Member Guest', 'member-guest@schedra.test', 'UTC', 'hosted', now()),
      (${organizationRow!.id}, ${managed!.sourceEventTypeId}, ${ownerUser!.id}, ${crypto.randomUUID()}, 'confirmed', now() + interval '2 days', now() + interval '2 days 45 minutes', 'Owner Guest', 'owner-guest@schedra.test', 'UTC', 'hosted', now())
  `

  await switchAccount(memberEmail, '/t/managed-studio/analytics')
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible()
  const memberExport = await page.request.get('/api/teams/managed-studio/analytics/export?days=30')
  expect(memberExport.ok()).toBe(true)
  const memberCsv = await memberExport.text()
  expect(memberCsv).toContain('member-guest@schedra.test')
  expect(memberCsv).not.toContain('owner-guest@schedra.test')
  expect(memberCsv).not.toContain('notes')

  await switchAccount(ownerEmail, '/t/managed-studio/analytics')
  const ownerExport = await page.request.get('/api/teams/managed-studio/analytics/export?days=30')
  expect(ownerExport.ok()).toBe(true)
  const ownerCsv = await ownerExport.text()
  expect(ownerCsv).toContain('member-guest@schedra.test')
  expect(ownerCsv).toContain('owner-guest@schedra.test')

  await page.goto('/t/managed-studio/event-types')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Edit Managed discovery' }).click()
  const detachDialog = page.getByRole('dialog', { name: 'Edit managed template' })
  await detachDialog.getByRole('checkbox', { name: 'Assign Managed Member' }).uncheck()
  await detachDialog.getByRole('button', { name: 'Save template' }).click()
  await expect(detachDialog).toBeHidden()
  const [detached] = await sql<{ assignments: number, links: number }[]>`
    select
      (select count(*)::int from organization_event_template_assignments where template_id = ${managed!.templateId}) as assignments,
      (select count(*)::int from event_types where id = ${managed!.eventTypeId}) as links
  `
  expect(detached).toEqual({ assignments: 0, links: 1 })

  await page.getByRole('button', { name: 'Archive Managed discovery' }).click()
  const archiveDialog = page.getByRole('dialog', { name: 'Archive this template?' })
  await archiveDialog.getByRole('button', { name: 'Archive template' }).click()
  await expect(archiveDialog).toBeHidden()
  const [archived] = await sql<{ archived: boolean, links: number }[]>`
    select
      (select archived_at is not null from organization_event_templates where id = ${managed!.templateId}) as archived,
      (select count(*)::int from event_types where id = ${managed!.eventTypeId}) as links
  `
  expect(archived).toEqual({ archived: true, links: 1 })
})

test('revokes invitations, transfers ownership and archives the team safely', async ({ page }) => {
  test.setTimeout(90_000)

  await signUpAndSignIn(page, {
    name: 'Future Owner',
    username: 'future-owner',
    email: 'future-owner@schedra.test'
  })
  await signOutLocally(page)

  await signUpAndSignIn(page, {
    name: 'Original Owner',
    username: 'original-owner',
    email: 'original-owner@schedra.test'
  })
  await createTeam(page, 'Lifecycle Team', 'lifecycle-team')

  const revokedId = await invite(page, 'revoked-member@schedra.test')
  const revokedRow = page.getByRole('listitem').filter({ hasText: 'revoked-member@schedra.test' })
  await revokedRow.getByRole('button', { name: 'Revoke' }).click()
  await expect(page.getByText('revoked-member@schedra.test', { exact: true })).toHaveCount(0)

  const [revoked] = await sql<{ status: string }[]>`
    select status from invitations where id = ${revokedId}
  `
  expect(revoked?.status).not.toBe('pending')

  const invitationId = await invite(page, 'future-owner@schedra.test')
  await signOutLocally(page)
  await signIn(page, 'future-owner@schedra.test', `/invite/${invitationId}`)
  await page.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(page).toHaveURL(/\/t\/lifecycle-team\/members$/)

  await signOutLocally(page)
  const ownerNext = '/t/lifecycle-team/members'
  const ownerLogin = new URLSearchParams({ next: ownerNext, email: 'original-owner@schedra.test' })
  await page.goto(`/login?${ownerLogin}`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill('original-owner@schedra.test')
  await page.locator('input[name="password"]').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Too many sign-in attempts. Wait a few seconds, then try again.')).toBeVisible()

  await sql`delete from rate_limits where key like '%|/sign-in/email'`
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/t\/lifecycle-team\/members$/)
  await page.getByRole('button', { name: 'Actions for Future Owner' }).click()
  await page.getByText('Make admin', { exact: true }).click()
  await expect(page.getByRole('main').getByText('admin', { exact: true })).toBeVisible()

  await page.goto('/t/lifecycle-team/settings')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Transfer ownership' }).click()
  const transferDialog = page.getByRole('dialog', { name: 'Transfer ownership' })
  await expect(transferDialog).toBeVisible()
  await transferDialog.getByText('Choose a member', { exact: true }).click()
  await page.getByText(/Future Owner · future-owner@schedra\.test/).click()
  await page.getByRole('button', { name: 'Transfer', exact: true }).click()
  await expect(page.getByText('You are an admin of this team.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Archive this team' })).toHaveCount(0)

  await signOutLocally(page)
  await signIn(page, 'future-owner@schedra.test', '/t/lifecycle-team/settings')
  await expect(page.getByText('You are the owner of this team.')).toBeVisible()
  await page.getByRole('button', { name: 'Archive this team' }).click()
  await page.getByLabel('Type lifecycle-team to confirm').fill('lifecycle-team')
  await page.getByRole('button', { name: 'Archive team' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)

  await page.goto('/team/lifecycle-team')
  await expect(page.getByRole('heading', { name: 'No such team page' })).toBeVisible()

  const [organization] = await sql<{ archived: boolean }[]>`
    select (archived_at is not null) as archived
    from organizations where name = 'Lifecycle Team'
  `
  expect(organization?.archived).toBe(true)
})
