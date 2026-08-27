import { expect, test, type Page } from '@playwright/test'
import postgres from 'postgres'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for Playwright tests.')

const sql = postgres(databaseUrl, { max: 2, onnotice: () => {} })
const password = 'a-production-grade-passphrase'

test.beforeEach(async () => {
  await sql`
    truncate table
      operations_alerts, webhook_deliveries, subscription_seat_sync_jobs,
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

async function signUpAndSignIn(page: Page, email: string, username: string) {
  await page.goto('/signup')
  await expect(page.getByTestId('signup-form')).toHaveAttribute('data-ready', 'true')
  await page.getByLabel('Your name').fill('Ada Operator')
  await page.getByLabel('Your booking link').fill(username)
  await page.getByLabel('Email').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await expect(page.getByText('Available', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Create my link' }).click()
  await expect(page).toHaveURL(/\/verify-email/)
  await sql`update users set email_verified = true where email = ${email}`

  await page.goto(`/login?email=${encodeURIComponent(email)}`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await expect(page.getByLabel('Email')).toHaveValue(email)
  await expect(page.locator('input[name="password"]')).toHaveValue(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
}

test('keeps operations private and retries a failed delivery job', async ({ page, request }) => {
  const [liveness, readiness] = await Promise.all([
    request.get('/api/healthz'),
    request.get('/api/readyz')
  ])
  expect(liveness.status()).toBe(200)
  expect(await liveness.json()).toMatchObject({ ok: true })
  expect(readiness.status()).toBe(200)
  // The public readiness response stays intentionally generic; detailed
  // checks belong on the authenticated operations page and in server logs.
  expect(await readiness.json()).toEqual({ ok: true })

  const unauthenticated = await request.get('/api/operations/overview')
  expect(unauthenticated.status()).toBe(401)
  expect(unauthenticated.headers()['x-request-id']).toBeTruthy()

  await signUpAndSignIn(page, 'ada-ops@schedra.test', 'ada-ops')
  await sql`
    insert into email_outbox (
      dedupe_key, recipient, subject, heading, body, action_label,
      action_url, status, attempts, last_error
    ) values (
      'ops-failed-email', 'guest@example.com', 'Booking confirmation',
      'Booking confirmed', 'Your booking is ready.', 'View booking',
      'http://127.0.0.1:3102/booking/example', 'failed', 8, 'Provider unavailable'
    )
  `
  await sql`
    insert into operations_alerts (key, type, severity, summary, details)
    values ('email-failed', 'email_delivery', 'warning', '1 email could not be delivered', '{"count":1}')
  `

  const overviewResponse = await page.request.get('/api/operations/overview')
  expect(overviewResponse.status(), await overviewResponse.text()).toBe(200)
  expect(overviewResponse.headers()['x-request-id']).toBeTruthy()

  await page.goto('/operations')
  await expect(page.getByRole('heading', { name: 'Operations', exact: true })).toBeVisible()
  await expect(page.getByText('Active alerts')).toBeVisible()
  await expect(page.getByText('1 email could not be delivered')).toBeVisible()
  await expect(page.getByText('Provider unavailable')).toHaveCount(0)

  await page.getByRole('button', { name: 'Email delivery' }).click()
  await page.getByRole('button', { name: 'failed', exact: true }).click()
  await expect(page.getByText('Booking confirmation · gu***@example.com')).toBeVisible()
  await expect(page.getByText('Provider unavailable')).toBeVisible()
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByText('Operation queued again', { exact: true })).toBeVisible()
  await expect(page.getByText('No matching operations')).toBeVisible()
})

test('does not expose the operations page to a normal signed-in user', async ({ page }) => {
  await signUpAndSignIn(page, 'member@schedra.test', 'member-ops-check')
  await page.goto('/operations')
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('link', { name: 'Operations' })).toHaveCount(0)
})
