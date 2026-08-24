import { expect, test } from '@playwright/test'
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
