import { expect, test } from '@playwright/test'
import { Temporal } from '@js-temporal/polyfill'
import postgres from 'postgres'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for Playwright tests.')
const sql = postgres(databaseUrl, { max: 2, onnotice: () => {} })
const username = `calendar-${crypto.randomUUID().slice(0, 8)}`
let hostId: string
let eventTypeId: string

test.beforeAll(async () => {
  const [host] = await sql`insert into users (email, name, username, email_verified, time_zone)
    values (${`${username}@schedra.test`}, 'Calendar test host', ${username}, true, 'UTC') returning id`
  hostId = host!.id
  const [schedule] = await sql`insert into schedules (user_id, name, time_zone, is_default)
    values (${hostId}, 'Browser test', 'UTC', true) returning id`
  await sql`insert into availability_rules (schedule_id, weekday, start_time, end_time)
    select ${schedule!.id}, day, '09:00'::time, '17:00'::time from generate_series(1, 7) day`
  const [event] = await sql`insert into event_types (user_id, schedule_id, slug, title, duration_minutes, minimum_notice_minutes, booking_window_days)
    values (${hostId}, ${schedule!.id}, 'intro', 'Calendar reliability demo', 30, 0, 180) returning id`
  eventTypeId = event!.id
})

test.afterAll(async () => {
  if (hostId) await sql`delete from users where id = ${hostId}`
  await sql.end()
})

test('books beyond the old eight-week limit on mobile using bounded availability requests', async ({ page }) => {
  test.setTimeout(90_000)
  const ranges: URL[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/api/availability') ranges.push(url)
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/${username}/intro`)
  await expect(page.getByTestId('booking-slot').first()).toBeVisible()
  for (let week = 0; week < 10; week++) await page.getByRole('button', { name: 'Next week' }).click()
  await page.locator('[data-testid="booking-day"]:not([disabled])').first().click()
  await page.getByTestId('booking-slot').first().click()
  await page.getByLabel('Your name').fill('Portfolio test guest')
  await page.getByLabel('Email', { exact: true }).fill('calendar-guest@schedra.test')
  await page.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(page.getByTestId('booking-confirmation')).toBeVisible()
  const [saved] = await sql`select starts_at from bookings where event_type_id = ${eventTypeId} and status = 'confirmed'`
  expect(new Date(saved!.starts_at).getTime() - Date.now()).toBeGreaterThan(62 * 86_400_000)
  expect(new Set(ranges.map(url => url.searchParams.get('from'))).size).toBeGreaterThan(1)
  for (const url of ranges) {
    const from = Temporal.PlainDate.from(url.searchParams.get('from')!)
    expect(from.until(Temporal.PlainDate.from(url.searchParams.get('to')!)).days).toBeLessThanOrEqual(62)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('reschedules on a full day without losing the existing allowance', async ({ page }) => {
  await sql`update event_types set max_per_day = 1 where id = ${eventTypeId}`
  const date = Temporal.Now.plainDateISO('UTC').add({ days: 2 }).toString()
  const uid = crypto.randomUUID()
  await sql`insert into bookings (event_type_id, host_id, uid, starts_at, ends_at, attendee_name, attendee_email, attendee_time_zone)
    values (${eventTypeId}, ${hostId}, ${uid}, ${`${date}T09:00Z`}, ${`${date}T09:30Z`}, 'Moving guest', 'moving@schedra.test', 'UTC')`
  await page.goto(`/${username}/intro?reschedule=${uid}`)
  await expect(page.getByText('Choose a new time. Your name and email are already filled in.')).toBeVisible()
  const dateLabel = new Date(`${date}T12:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
  await page.getByRole('button', { name: new RegExp(dateLabel) }).click()
  await page.getByTestId('booking-slot').nth(3).click()
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('moving@schedra.test')
  await page.getByRole('button', { name: /Reschedule|Move booking|Confirm new time/ }).click()
  await expect(page.getByTestId('booking-confirmation')).toBeVisible()
  expect((await sql`select status from bookings where uid = ${uid}`)[0]!.status).toBe('cancelled')
  const [moved] = await sql`select starts_at from bookings where event_type_id = ${eventTypeId} and attendee_email = 'moving@schedra.test' and status = 'confirmed'`
  expect(new Date(moved!.starts_at).toISOString().slice(0, 10)).toBe(date)
})

test('shows the payment warning only when the running server reports sandbox', async ({ page, request }) => {
  const actual = await request.get('/api/payment-environment')
  expect(await actual.json()).toEqual({ mode: 'disabled' })
  expect(actual.headers()['cache-control']).toContain('no-store')
  for (const mode of ['sandbox', 'live']) {
    await page.route('**/api/payment-environment', route => route.fulfill({ json: { mode } }))
    await page.goto('/pricing')
    const notice = page.getByRole('note', { name: 'Sandbox payments' })
    if (mode === 'sandbox') await expect(notice).toContainText('not real charges')
    else await expect(notice).toHaveCount(0)
    await page.unroute('**/api/payment-environment')
  }
})
