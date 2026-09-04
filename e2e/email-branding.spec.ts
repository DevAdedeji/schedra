import { expect, test, type Page } from '@playwright/test'
import postgres from 'postgres'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for Playwright tests.')

const sql = postgres(databaseUrl, { max: 2, onnotice: () => {} })
const password = 'a-production-grade-passphrase'

test.beforeEach(async () => {
  await sql`truncate table api_rate_limits, rate_limits, users, organizations restart identity cascade`
})

test.afterAll(async () => {
  await sql.end()
})

async function signUpAndSignIn(page: Page) {
  await page.goto('/signup')
  await expect(page.getByTestId('signup-form')).toHaveAttribute('data-ready', 'true')
  await page.getByLabel('Your name').fill('Email Brand Owner')
  await page.getByLabel('Your booking link').fill('email-brand-owner')
  await page.getByLabel('Email').fill('email-brand-owner@schedra.test')
  await page.locator('input[name="password"]').fill(password)
  await expect(page.getByText('Available', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Create my link' }).click()
  await expect(page).toHaveURL(/\/verify-email/)

  await sql`update users set email_verified = true where email = 'email-brand-owner@schedra.test'`
  await page.goto('/login?email=email-brand-owner%40schedra.test')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill('email-brand-owner@schedra.test')
  await page.locator('input[name="password"]').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
}

async function enablePersonalPro() {
  await sql`
    insert into personal_subscriptions (
      user_id, status, interval, collection_method, current_period_end
    )
    select id, 'active', 'monthly', 'charge_automatically', now() + interval '1 month'
    from users where email = 'email-brand-owner@schedra.test'
  `
}

test('customizes personal guest emails safely on mobile and persists the result', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signUpAndSignIn(page)

  await page.goto('/settings')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('heading', { name: 'Make guest emails sound like you' })).toBeVisible()

  await enablePersonalPro()
  await page.reload()
  await page.waitForLoadState('networkidle')

  const editor = page.getByTestId('booking-email-template-settings')
  await expect(editor).toBeVisible()
  const box = await editor.boundingBox()
  expect(box?.width).toBeLessThanOrEqual(374)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  await editor.getByRole('switch', { name: 'Customize Booking confirmed' }).click()
  await editor.getByLabel('Subject').fill('Confirmed: {{manage_url}}')
  await editor.getByRole('button', { name: 'Save email templates' }).click()
  await expect(page.getByText('Use only the supported variables shown below the editor.', { exact: true })).toBeVisible()

  await editor.getByLabel('Subject').fill('Your {{event_name}} is confirmed')
  await editor.getByLabel('Message').fill(
    'Hello {{guest_name}}, {{host_name}} will meet you at {{start_time}} ({{time_zone}}).'
  )
  await editor.getByLabel('Email footer').fill('Thank you for choosing us.')
  await editor.getByRole('button', { name: 'Save email templates' }).click()
  await expect(page.getByText('Email templates saved', { exact: true })).toBeVisible()

  await page.reload()
  await page.waitForLoadState('networkidle')
  await expect(editor.getByLabel('Subject')).toHaveValue('Your {{event_name}} is confirmed')
  await expect(editor.getByLabel('Email footer')).toHaveValue('Thank you for choosing us.')
  await expect(editor.getByText(/Hello Maya, Alex will meet you at Tuesday/)).toBeVisible()

  const [stored] = await sql<{ subject: string, footer: string }[]>`
    select
      booking_email_templates->'templates'->'confirmation'->>'subject' as subject,
      booking_email_templates->>'footer' as footer
    from users where email = 'email-brand-owner@schedra.test'
  `
  expect(stored).toEqual({
    subject: 'Your {{event_name}} is confirmed',
    footer: 'Thank you for choosing us.'
  })
})

test('saves team guest email templates and records an audit entry', async ({ page }) => {
  await signUpAndSignIn(page)
  await page.getByRole('button', { name: /Current team: Personal\. Switch team/ }).click()
  await page.getByText('Create team', { exact: true }).click()
  await page.getByLabel('Team name').fill('Email Brand Team')
  await page.getByLabel('Team address').fill('email-brand-team')
  await expect(page.getByRole('button', { name: 'Create team', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Create team', exact: true }).click()
  await expect(page).toHaveURL(/\/t\/email-brand-team\/members$/)

  await page.goto('/t/email-brand-team/settings')
  await page.waitForLoadState('networkidle')
  const editor = page.getByTestId('booking-email-template-settings')
  await expect(editor).toBeVisible()
  await editor.getByRole('switch', { name: 'Customize Booking confirmed' }).click()
  await expect(editor.getByLabel('Subject')).toBeVisible()
  await editor.getByLabel('Subject').fill('Team booking: {{event_name}}')
  await editor.getByLabel('Message').fill('Hello {{guest_name}}, {{host_name}} will see you at {{start_time}}.')
  await editor.getByRole('button', { name: 'Save email templates' }).click()
  await expect(page.getByText('Email templates saved', { exact: true })).toBeVisible()

  const [stored] = await sql<{ subject: string, audits: number }[]>`
    select
      organizations.booking_email_templates->'templates'->'confirmation'->>'subject' as subject,
      count(organization_audit_logs.id)::int as audits
    from organizations
    left join organization_audit_logs
      on organization_audit_logs.organization_id = organizations.id
      and organization_audit_logs.action = 'organization.booking_email_templates_updated'
    where organizations.slug = 'email-brand-team'
    group by organizations.id
  `
  expect(stored).toEqual({ subject: 'Team booking: {{event_name}}', audits: 1 })
})
