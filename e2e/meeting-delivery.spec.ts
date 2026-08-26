import { expect, test, type Page } from '@playwright/test'
import postgres from 'postgres'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for Playwright tests.')

const sql = postgres(databaseUrl, { max: 2, onnotice: () => {} })

test.beforeEach(async () => {
  await sql`
    truncate table
      calendar_sync_jobs, booking_calendar_events, calendar_connections,
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
  await page.getByLabel('Password').fill('a-production-grade-passphrase')
  await expect(page.getByText('Available', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Create my link' }).click()
  await expect(page).toHaveURL(/\/verify-email/)

  await sql`update users set email_verified = true where email = ${account.email}`

  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill('a-production-grade-passphrase')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
}

test('creates an event and completes the guest booking lifecycle', async ({ page, request }) => {
  await page.goto('/signup')
  await expect(page.getByTestId('signup-form')).toHaveAttribute('data-ready', 'true')
  await page.getByLabel('Your name').fill('E2E Host')
  await page.getByLabel('Your booking link').fill('e2e-host')
  await page.getByLabel('Email').fill('e2e-host@schedra.test')
  await page.getByLabel('Password').fill('a-production-grade-passphrase')
  await expect(page.getByText('Available', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Create my link' }).click()
  await expect(page).toHaveURL(/\/verify-email/)

  await sql`update users set email_verified = true where email = 'e2e-host@schedra.test'`

  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill('e2e-host@schedra.test')
  await page.getByLabel('Password').fill('a-production-grade-passphrase')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { name: 'Hello, E2E' })).toBeVisible()

  await page.goto('/event-types')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'New event type' }).click()
  await page.getByLabel('Event name').fill('E2E consultation')
  await page.getByLabel('Description').fill('A complete scheduling lifecycle test.')
  await page.getByRole('button', { name: 'Add question' }).click()
  await page.getByLabel('Question', { exact: true }).fill('What should we prepare?')
  await page.getByLabel('Guests must answer this question').check()
  await expect(page.getByRole('button', { name: 'Create event type' })).toBeEnabled()
  await page.getByRole('button', { name: 'Create event type' }).click()
  await expect(page.getByRole('heading', { name: 'E2E consultation' })).toBeVisible()

  await page.goto('/e2e-host/e2e-consultation')
  await page.waitForLoadState('networkidle')
  await page.getByTestId('booking-slot').first().click()
  await page.getByLabel('Your name').fill('E2E Guest')
  await page.getByLabel('Email').fill('e2e-guest@schedra.test')
  await page.getByLabel('What should we prepare?').fill('The onboarding metrics')
  await page.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(page.getByTestId('booking-confirmation')).toContainText('You\'re booked')

  await page.getByRole('link', { name: 'View or change booking' }).click()
  await expect(page.getByText('Meeting details', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Guest responses' })).toBeVisible()
  await expect(page.getByText('The onboarding metrics')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Add to calendar' })).toBeVisible()

  const firstBookingUrl = page.url()
  const firstUid = firstBookingUrl.split('/').at(-1)!
  const calendar = await request.get(`/api/booking/${firstUid}/calendar.ics`)
  expect(calendar.ok()).toBe(true)
  expect(await calendar.text()).toContain('BEGIN:VCALENDAR')

  await page.getByRole('link', { name: 'Move to another time' }).click()
  await expect(page.getByText('Choose a new time. Your name and email are already filled in.')).toBeVisible()
  await page.getByTestId('booking-slot').first().click()
  await expect(page.getByLabel('Your name')).toHaveValue('E2E Guest')
  await expect(page.getByLabel('Email')).toHaveValue('e2e-guest@schedra.test')
  await expect(page.getByLabel('What should we prepare?')).toHaveValue('The onboarding metrics')
  await page.getByRole('button', { name: 'Confirm new time' }).click()
  await expect(page.getByTestId('booking-confirmation')).toContainText('You\'re booked')

  await page.getByRole('link', { name: 'View or change booking' }).click()
  await page.getByRole('button', { name: 'Cancel booking' }).click()
  await page.getByRole('button', { name: 'Yes, cancel it' }).click()
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible()

  const bookings = await sql<{ status: string, answers: { responses?: Array<{ label: string, value: string }> } }[]>`
    select status, answers from bookings order by created_at
  `
  expect(bookings.map(booking => booking.status)).toEqual(['cancelled', 'cancelled'])
  expect(bookings[1]?.answers.responses).toEqual([
    expect.objectContaining({ label: 'What should we prepare?', value: 'The onboarding metrics' })
  ])

  const liveReminders = await sql<{ count: number }[]>`
    select count(*)::int as count from email_outbox
    where category = 'booking_reminder' and status = 'pending'
  `
  expect(liveReminders[0]?.count).toBe(0)
})

test('holds approval requests, invites additional guests and duplicates the event safely', async ({ page }) => {
  await signUpAndSignIn(page, {
    name: 'Approval Host',
    username: 'approval-host',
    email: 'approval-host@schedra.test'
  })

  await page.goto('/event-types')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'New event type' }).click()
  await page.getByLabel('Event name').fill('Approval consultation')
  await page.getByLabel('Description').fill('A request that the host reviews before confirmation.')
  await page.getByRole('switch', { name: 'Require approval before confirming bookings' }).click()
  await page.getByRole('button', { name: 'Create event type' }).click()
  await expect(page.getByRole('heading', { name: 'Approval consultation' })).toBeVisible()
  await expect(page.getByText('Approval required', { exact: true })).toBeVisible()

  await page.goto('/approval-host/approval-consultation')
  await page.waitForLoadState('networkidle')
  await page.getByTestId('booking-slot').first().click()
  await page.getByLabel('Your name').fill('Primary Guest')
  await page.getByLabel('Email').fill('primary-guest@schedra.test')
  await page.getByRole('button', { name: 'Add guest' }).click()
  await page.getByLabel('Additional guest 1 email').fill('teammate@schedra.test')
  await page.getByLabel('Notes').fill('Please review the project brief.')
  await page.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(page.getByTestId('booking-confirmation')).toContainText('Request sent')
  await expect(page.getByTestId('booking-confirmation')).toContainText('email you when the host responds')

  const [pending] = await sql<{
    uid: string
    status: string
    additionalGuestEmails: string[]
  }[]>`
    select uid, status, additional_guest_emails as "additionalGuestEmails"
    from bookings
    where attendee_email = 'primary-guest@schedra.test'
  `
  expect(pending).toMatchObject({
    status: 'pending',
    additionalGuestEmails: ['teammate@schedra.test']
  })

  const requestMessages = await sql<{ count: number }[]>`
    select count(*)::int as count from email_outbox
    where dedupe_key like ${`booking:${pending!.uid}:requested:%`}
  `
  expect(requestMessages[0]?.count).toBe(3)

  const jobsBeforeApproval = await sql<{ count: number }[]>`
    select count(*)::int as count from calendar_sync_jobs
    where booking_id = (select id from bookings where uid = ${pending!.uid})
  `
  expect(jobsBeforeApproval[0]?.count).toBe(0)

  await page.goto('/bookings')
  await page.waitForLoadState('networkidle')
  await page.getByRole('tab', { name: /Requests 1/ }).click()
  await expect(page.getByText('Needs approval', { exact: true })).toBeVisible()
  await expect(page.getByText('+ 1 additional guest', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByText('Booking approved', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'No booking requests' })).toBeVisible()

  const [approved] = await sql<{ status: string }[]>`
    select status from bookings where uid = ${pending!.uid}
  `
  expect(approved?.status).toBe('confirmed')

  const jobsAfterApproval = await sql<{ action: string, status: string }[]>`
    select action, status from calendar_sync_jobs
    where booking_id = (select id from bookings where uid = ${pending!.uid})
  `
  expect(jobsAfterApproval).toEqual([
    expect.objectContaining({ action: 'upsert', status: 'pending' })
  ])

  await page.goto('/approval-host/approval-consultation')
  await page.waitForLoadState('networkidle')
  await page.getByTestId('booking-slot').first().click()
  await page.getByLabel('Your name').fill('Declined Guest')
  await page.getByLabel('Email').fill('declined-guest@schedra.test')
  await page.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(page.getByTestId('booking-confirmation')).toContainText('Request sent')

  await page.goto('/bookings')
  await page.waitForLoadState('networkidle')
  await page.getByRole('tab', { name: /Requests 1/ }).click()
  await page.getByRole('button', { name: 'Decline' }).click()
  await expect(page.getByText('Request declined', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'No booking requests' })).toBeVisible()

  const [declined] = await sql<{ id: string, uid: string, status: string }[]>`
    select id, uid, status from bookings
    where attendee_email = 'declined-guest@schedra.test'
  `
  expect(declined?.status).toBe('rejected')
  const declinedJobs = await sql<{ count: number }[]>`
    select count(*)::int as count from calendar_sync_jobs where booking_id = ${declined!.id}
  `
  expect(declinedJobs[0]?.count).toBe(0)
  const declinedMessages = await sql<{ count: number }[]>`
    select count(*)::int as count from email_outbox
    where dedupe_key like ${`booking:${declined!.uid}:rejected:%`}
  `
  expect(declinedMessages[0]?.count).toBe(1)

  await page.goto('/event-types')
  await page.waitForLoadState('networkidle')
  const approvalEvent = page.getByRole('listitem').filter({
    has: page.getByRole('heading', { name: 'Approval consultation', exact: true })
  })
  await approvalEvent.getByRole('button', { name: 'Duplicate event type' }).click()
  await expect(page.getByRole('heading', { name: 'Approval consultation (copy)' })).toBeVisible()

  const copies = await sql<{
    slug: string
    hidden: boolean
    requiresConfirmation: boolean
  }[]>`
    select slug, hidden, requires_confirmation as "requiresConfirmation"
    from event_types
    order by created_at
  `
  expect(copies).toHaveLength(3)
  expect(copies).toContainEqual(
    expect.objectContaining({ slug: 'approval-consultation', hidden: false, requiresConfirmation: true })
  )
  expect(copies).toContainEqual(
    expect.objectContaining({ slug: 'approval-consultation-copy', hidden: true, requiresConfirmation: true })
  )
})

test('exports portable account data and permanently removes the account', async ({ page }) => {
  const email = 'account-owner@schedra.test'
  await signUpAndSignIn(page, {
    name: 'Account Owner',
    username: 'account-owner',
    email
  })

  const accountRequest = page.context().request
  const exportedResponse = await accountRequest.get('/api/account/export')
  expect(exportedResponse.ok()).toBe(true)
  expect(exportedResponse.headers()['content-disposition']).toContain('schedra-export-')

  const exported = await exportedResponse.json()
  expect(exported.profile).toMatchObject({ email, username: 'account-owner' })
  expect(exported.schedules).toHaveLength(1)
  expect(exported.eventTypes).toHaveLength(1)
  expect(JSON.stringify(exported)).not.toContain('accessTokenEncrypted')
  expect(JSON.stringify(exported)).not.toContain('refreshTokenEncrypted')

  const rejectedDeletion = await accountRequest.delete('/api/account', {
    data: { email, confirmation: 'delete' }
  })
  expect(rejectedDeletion.status()).toBe(400)

  const deletedResponse = await accountRequest.delete('/api/account', {
    data: { email, confirmation: 'DELETE' }
  })
  expect(deletedResponse.ok()).toBe(true)

  const remaining = await sql<{ count: number }[]>`
    select count(*)::int as count from users where email = ${email}
  `
  expect(remaining[0]?.count).toBe(0)

  const sessionAfterDeletion = await accountRequest.get('/api/me')
  expect(sessionAfterDeletion.ok()).toBe(true)
  expect(await sessionAfterDeletion.json()).toMatchObject({ user: null })

  const protectedAfterDeletion = await accountRequest.get('/api/account/export')
  expect(protectedAfterDeletion.status()).toBe(401)
})
