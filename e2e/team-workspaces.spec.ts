import { expect, test, type Page } from '@playwright/test'
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
