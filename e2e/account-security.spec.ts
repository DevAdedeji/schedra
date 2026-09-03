import { createHmac } from 'node:crypto'
import { expect, test } from '@playwright/test'
import postgres from 'postgres'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for Playwright tests.')

const sql = postgres(databaseUrl, { max: 2, onnotice: () => {} })
const password = 'a-production-grade-passphrase'
const email = 'two-factor-owner@schedra.test'

function authenticatorCode(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const character of secret.replaceAll('=', '').toUpperCase()) {
    const value = alphabet.indexOf(character)
    if (value < 0) throw new Error('Invalid authenticator secret.')
    bits += value.toString(2).padStart(5, '0')
  }
  const key = Buffer.from(Array.from({ length: Math.floor(bits.length / 8) }, (_, index) =>
    Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)))
  const digest = createHmac('sha1', key).update(counter).digest()
  const offset = digest[digest.length - 1]! & 0x0f
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return value.toString().padStart(6, '0')
}

test.beforeEach(async () => {
  await sql`
    truncate table
      two_factors, email_notification_preferences,
      worker_leases, worker_instances, operations_alerts, webhook_deliveries,
      subscription_seat_sync_jobs, calendar_sync_jobs, booking_calendar_events,
      calendar_connections, email_outbox, api_rate_limits, rate_limits, sessions,
      accounts, verifications, bookings, event_types, date_overrides,
      availability_rules, schedules, users, organizations
    restart identity cascade
  `
})

test.afterAll(async () => {
  await sql.end()
})

test('enables authenticator security and accepts both authenticator and backup codes', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/signup')
  await expect(page.getByTestId('signup-form')).toHaveAttribute('data-ready', 'true')
  await page.getByLabel('Your name').fill('Two Factor Owner')
  await page.getByLabel('Your booking link').fill('two-factor-owner')
  await page.getByLabel('Email').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await expect(page.getByText('Available', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Create my link' }).click()
  await expect(page).toHaveURL(/\/verify-email/)
  await sql`update users set email_verified = true where email = ${email}`

  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)

  await page.goto('/settings')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Set up 2FA' }).click()
  const setup = page.getByRole('dialog', { name: 'Set up two-factor authentication' })
  await setup.getByLabel('Current password').fill(password)
  await setup.getByRole('button', { name: 'Continue' }).click()
  const secret = (await setup.locator('code').first().textContent())?.trim()
  expect(secret).toBeTruthy()
  await setup.getByLabel('Authentication code').fill(authenticatorCode(secret!))
  await setup.getByRole('button', { name: 'Verify and enable' }).click()
  await expect(setup.getByText('Save these single-use backup codes somewhere secure.')).toBeVisible()
  const backupCodes = (await setup.locator('div.grid code').allTextContents()).map(code => code.trim()).filter(Boolean)
  expect(backupCodes.length).toBeGreaterThan(0)
  await setup.getByRole('button', { name: 'I saved them' }).click()
  await expect(page.getByText('Enabled for this account.')).toBeVisible()
  const [enabled] = await sql<{ enabled: boolean }[]>`
    select two_factor_enabled as enabled from users where email = ${email}
  `
  expect(enabled?.enabled).toBe(true)

  await page.context().clearCookies()
  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/two-factor/)
  await expect(page.getByTestId('two-factor-challenge')).toHaveAttribute('data-ready', 'true')
  expect((await page.request.get('/api/bookings')).status()).toBe(401)
  await page.getByLabel('Authentication code').fill(authenticatorCode(secret!))
  await page.getByRole('button', { name: 'Verify and sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)

  await page.context().clearCookies()
  await sql`delete from rate_limits`
  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/two-factor/)
  await expect(page.getByTestId('two-factor-challenge')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Use a backup code instead' }).click()
  await page.getByLabel('Backup code').fill(backupCodes[0]!)
  await page.getByRole('button', { name: 'Verify and sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)

  await page.context().clearCookies()
  await sql`delete from rate_limits`
  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/two-factor/)
  await expect(page.getByTestId('two-factor-challenge')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Use a backup code instead' }).click()
  await page.getByLabel('Backup code').fill(backupCodes[0]!)
  await page.getByRole('button', { name: 'Verify and sign in' }).click()
  await expect(page.getByRole('alert')).toContainText('not valid')
  await expect(page).toHaveURL(/\/two-factor/)
})
