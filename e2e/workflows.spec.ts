import { expect, test, type Page } from '@playwright/test'
import postgres from 'postgres'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for Playwright tests.')

const sql = postgres(databaseUrl, { max: 2, onnotice: () => {} })
const password = 'a-production-grade-passphrase'

test.beforeEach(async () => {
  await sql`
    truncate table
      automation_runs, domain_events, automation_workflows,
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

async function signUpAndSignIn(page: Page) {
  await page.goto('/signup')
  await expect(page.getByTestId('signup-form')).toHaveAttribute('data-ready', 'true')
  await page.getByLabel('Your name').fill('Ada Automation')
  await page.getByLabel('Your booking link').fill('ada-automation')
  await page.getByLabel('Email').fill('ada-automation@schedra.test')
  await page.locator('input[name="password"]').fill(password)
  await expect(page.getByText('Available', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Create my link' }).click()
  await expect(page).toHaveURL(/\/verify-email/)
  await sql`update users set email_verified = true where email = 'ada-automation@schedra.test'`

  await page.goto('/login?email=ada-automation%40schedra.test')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill('ada-automation@schedra.test')
  await page.locator('input[name="password"]').fill(password)
  await expect(page.getByLabel('Email')).toHaveValue('ada-automation@schedra.test')
  await expect(page.locator('input[name="password"]')).toHaveValue(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
}

test('creates, updates, pauses and deletes a workflow without hydration errors', async ({ page, request }) => {
  const unauthenticated = await request.get('/api/workflows')
  expect(unauthenticated.status()).toBe(401)

  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') consoleErrors.push(message.text())
  })
  await signUpAndSignIn(page)
  await page.goto('/workflows')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New workflow' })).toBeVisible()

  await page.getByRole('button', { name: 'New workflow' }).click()
  await page.getByLabel('Workflow name').fill('Guest reminder')
  await page.getByRole('button', { name: 'Create workflow' }).click()
  await expect(page.getByText('Workflow created', { exact: true })).toBeVisible()
  await expect(page.getByText('Guest reminder', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Actions for Guest reminder' }).click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  const selectors = page.getByRole('button', { name: 'Show popup' })
  await selectors.nth(0).click()
  await page.getByRole('option', { name: /Before a meeting starts/ }).click()
  await expect(page.getByText('How long before?')).toBeVisible()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('1 hour before', { exact: false })).toBeVisible()

  await page.getByRole('switch', { name: 'Pause Guest reminder' }).click()
  await expect(page.getByText('Paused', { exact: true })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Resume Guest reminder' })).toBeVisible()

  await page.getByRole('button', { name: 'Actions for Guest reminder' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  const confirmation = page.getByRole('dialog', { name: 'Delete this workflow?' })
  await confirmation.getByRole('button', { name: 'Delete workflow' }).click()
  await expect(page.getByText('No workflows yet')).toBeVisible()

  expect(consoleErrors.filter(message => /hydration|unhandled|failed/i.test(message))).toEqual([])
})

test('keeps the workflow form usable on mobile and rejects unsafe webhook URLs', async ({ page }) => {
  await signUpAndSignIn(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/workflows')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('button', { name: 'New workflow' })).toBeEnabled()
  await page.getByRole('button', { name: 'New workflow' }).click()
  const dialog = page.getByRole('dialog', { name: 'New workflow' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Workflow name').fill('Unsafe webhook')
  await dialog.getByRole('button', { name: 'Send a webhook' }).click()
  await dialog.getByLabel('Webhook URL').fill('http://localhost/internal')
  await dialog.getByRole('button', { name: 'Create workflow' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Webhook URLs must use HTTPS.')
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Create workflow' })).toBeVisible()
})
