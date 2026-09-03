import { expect, test, type Page } from '@playwright/test'
import postgres from 'postgres'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for Playwright tests.')

const sql = postgres(databaseUrl, { max: 2, onnotice: () => {} })
const password = 'a-production-grade-passphrase'

type AvailabilityResponse = {
  slots: Array<{ start: string, end: string }>
}

test.beforeEach(async () => {
  await sql`
    truncate table
      security_audit_logs, personal_invoices, personal_subscriptions,
      away_periods, booking_series,
      worker_leases, worker_instances, operations_alerts, webhook_deliveries,
      subscription_seat_sync_jobs, calendar_sync_jobs, booking_calendar_events,
      calendar_connections, email_outbox, api_rate_limits, rate_limits,
      sessions, accounts, verifications, bookings, event_types, date_overrides,
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

  await page.goto(`/login?email=${encodeURIComponent(account.email)}`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(account.email)
  await page.locator('input[name="password"]').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
}

async function activatePersonalPro(email: string) {
  await sql`
    insert into personal_subscriptions (
      user_id, status, interval, collection_method, current_period_end
    )
    select id, 'active', 'monthly', 'charge_automatically', now() + interval '1 month'
    from users where email = ${email}
  `
}

function availabilityRange() {
  const from = new Date()
  from.setUTCDate(from.getUTCDate() - ((from.getUTCDay() + 6) % 7))
  const to = new Date(from)
  to.setUTCDate(to.getUTCDate() + 62)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

function weekKey(value: string) {
  const date = new Date(value)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date.toISOString().slice(0, 10)
}

async function publicAvailability(
  request: Page['request'],
  username: string,
  slug: string,
  durationMinutes?: number
) {
  const params = { username, slug, ...availabilityRange() }
  const response = await request.get('/api/availability', {
    params: durationMinutes ? { ...params, durationMinutes } : params
  })
  expect(response.ok()).toBe(true)
  return response.json() as Promise<AvailabilityResponse>
}

test('manages time off on mobile, blocks its date and rejects overlaps and anonymous access', async ({ page, request }) => {
  expect((await request.get('/api/away-periods')).status()).toBe(401)
  await signUpAndSignIn(page, {
    name: 'Away Host', username: 'away-host', email: 'away-host@schedra.test'
  })

  const [eventType] = await sql<{ slug: string }[]>`
    select slug from event_types
    where user_id = (select id from users where email = 'away-host@schedra.test')
    order by created_at limit 1
  `
  const initial = await publicAvailability(page.request, 'away-host', eventType!.slug)
  expect(initial.slots.length).toBeGreaterThan(0)
  const blockedDate = initial.slots[0]!.start.slice(0, 10)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/availability')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Add time off' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add time off' })
  await expect(dialog).toBeVisible()
  const box = await dialog.boundingBox()
  expect(box?.width).toBeLessThanOrEqual(371)
  await dialog.getByLabel('Name').fill('Launch break')
  await dialog.getByLabel('Starts').fill(blockedDate)
  await dialog.getByLabel('Ends').fill(blockedDate)
  await dialog.getByRole('button', { name: 'Add time off' }).click()
  await expect(page.getByText('Launch break', { exact: true })).toBeVisible()

  const blocked = await publicAvailability(page.request, 'away-host', eventType!.slug)
  expect(blocked.slots.filter(slot => slot.start.slice(0, 10) === blockedDate)).toHaveLength(0)

  await page.getByRole('button', { name: 'Add time off' }).first().click()
  const overlap = page.getByRole('dialog', { name: 'Add time off' })
  await overlap.getByLabel('Name').fill('Overlapping break')
  await overlap.getByLabel('Starts').fill(blockedDate)
  await overlap.getByLabel('Ends').fill(blockedDate)
  await overlap.getByRole('button', { name: 'Add time off' }).click()
  await expect(overlap.getByRole('alert')).toContainText('overlaps another away period')
  await overlap.getByRole('button', { name: 'Cancel' }).click()

  await page.getByRole('button', { name: 'Edit Launch break' }).click()
  const edit = page.getByRole('dialog', { name: 'Edit time off' })
  await edit.getByLabel('Name').fill('Conference travel')
  await edit.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Conference travel', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Remove Conference travel' }).click()
  await page.getByRole('dialog', { name: 'Remove time off' })
    .getByRole('button', { name: 'Remove time off' }).click()
  await expect(page.getByRole('heading', { name: 'No time off scheduled' })).toBeVisible()

  const restored = await publicAvailability(page.request, 'away-host', eventType!.slug)
  expect(restored.slots.some(slot => slot.start.slice(0, 10) === blockedDate)).toBe(true)
})

test('enforces weekly and monthly booking limits configured in the event editor', async ({ page, request }) => {
  await signUpAndSignIn(page, {
    name: 'Limit Host', username: 'limit-host', email: 'limit-host@schedra.test'
  })
  await page.goto('/event-types')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'New event type' }).click()
  const create = page.getByRole('dialog', { name: 'New event type' })
  await create.getByLabel('Event name').fill('Capacity guard')
  await create.getByRole('button', { name: 'Expand all' }).click()
  await create.getByLabel('Per week').fill('1')
  await create.getByLabel('Per month').fill('2')
  await create.getByRole('button', { name: 'Create event type' }).click()
  await expect(page.getByText('Up to 1 per week', { exact: true })).toBeVisible()
  await expect(page.getByText('Up to 2 per month', { exact: true })).toBeVisible()

  const [eventType] = await sql<{ id: string, slug: string }[]>`
    select id, slug from event_types where title = 'Capacity guard'
  `
  const initial = await publicAvailability(request, 'limit-host', eventType!.slug)
  expect(initial.slots.length).toBeGreaterThan(0)
  const selected = initial.slots[0]!

  const booking = await request.post('/api/bookings', {
    data: {
      username: 'limit-host', slug: eventType!.slug, start: selected.start,
      durationMinutes: 30, name: 'Weekly Guest', email: 'weekly-guest@schedra.test',
      timeZone: 'UTC'
    }
  })
  expect(booking.ok()).toBe(true)

  const afterWeeklyLimit = await publicAvailability(request, 'limit-host', eventType!.slug)
  expect(afterWeeklyLimit.slots.filter(slot => weekKey(slot.start) === weekKey(selected.start))).toHaveLength(0)

  const card = page.getByRole('listitem').filter({
    has: page.getByRole('heading', { name: 'Capacity guard', exact: true })
  })
  await card.locator('button').first().click()
  const edit = page.getByRole('dialog', { name: 'Edit event type' })
  await edit.getByRole('button', { name: 'Expand all' }).click()
  await edit.getByLabel('Per week').fill('')
  await edit.getByLabel('Per month').fill('1')
  await edit.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Up to 1 per month', { exact: true })).toBeVisible()

  const afterMonthlyLimit = await publicAvailability(request, 'limit-host', eventType!.slug)
  const bookedMonth = selected.start.slice(0, 7)
  expect(afterMonthlyLimit.slots.filter(slot => slot.start.startsWith(bookedMonth))).toHaveLength(0)
  expect(afterMonthlyLimit.slots.some(slot => !slot.start.startsWith(bookedMonth))).toBe(true)
})

test('books a monthly series at a guest-selected duration and enforces the configured series maximum', async ({ page, request }) => {
  await signUpAndSignIn(page, {
    name: 'Series Host', username: 'series-host', email: 'series-host@schedra.test'
  })
  await page.goto('/event-types')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'New event type' }).click()
  const create = page.getByRole('dialog', { name: 'New event type' })
  await create.getByLabel('Event name').fill('Flexible series')
  await create.getByRole('button', { name: 'Offer another duration' }).click()
  await create.getByLabel('Another duration in minutes').fill('60')
  await create.getByRole('button', { name: 'Add', exact: true }).click()
  await create.getByRole('button', { name: 'Expand all' }).click()
  await create.getByRole('switch', { name: 'Allow guests to create recurring bookings' }).click()
  await create.getByLabel('Maximum meetings in one series').click()
  await page.getByRole('option', { name: '2 meetings' }).click()
  await create.getByRole('button', { name: 'Create event type' }).click()
  await expect(page.getByText('30 / 60 min', { exact: true })).toBeVisible()

  await page.goto('/series-host/flexible-series')
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('How long do you need?')).toBeVisible()
  await page.getByRole('button', { name: '60 min' }).click()
  await page.getByTestId('booking-slot').first().click()
  await page.getByLabel('Repeat booking').click()
  await page.getByRole('option', { name: 'Monthly' }).click()
  const recurringDates = page.getByRole('list', { name: 'Recurring meeting dates' }).getByRole('listitem')
  const unavailable = page.getByRole('alert').filter({ hasText: 'is not available' })
  await expect(recurringDates).toHaveCount(2)
  for (let attempt = 0; attempt < 8 && await unavailable.count(); attempt += 1) {
    const previousFirstDate = await recurringDates.first().textContent()
    await page.getByRole('button', { name: 'Next week' }).click()
    await page.getByTestId('booking-slot').first().click()
    await expect(recurringDates.first()).not.toHaveText(previousFirstDate ?? '')
  }
  await expect(unavailable).toHaveCount(0)
  await page.getByLabel('Your name').fill('Series Guest')
  await page.getByLabel('Email').fill('series-guest@schedra.test')
  await page.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(page.getByTestId('booking-confirmation')).toContainText('2 meetings booked')

  const series = await sql<{
    frequency: string
    occurrenceCount: number
    durationMinutes: number
  }[]>`
    select frequency, occurrence_count as "occurrenceCount", duration_minutes as "durationMinutes"
    from booking_series
  `
  expect(series).toEqual([{ frequency: 'monthly', occurrenceCount: 2, durationMinutes: 60 }])
  const occurrences = await sql<{ position: number, duration: number }[]>`
    select series_position as position,
      extract(epoch from (ends_at - starts_at))::int / 60 as duration
    from bookings where series_id is not null order by series_position
  `
  expect(occurrences).toEqual([{ position: 1, duration: 60 }, { position: 2, duration: 60 }])

  const available = await publicAvailability(request, 'series-host', 'flexible-series', 60)
  const excessive = await request.post('/api/bookings', {
    data: {
      username: 'series-host', slug: 'flexible-series', start: available.slots[0]!.start,
      durationMinutes: 60, requestId: crypto.randomUUID(),
      recurrence: { frequency: 'monthly', occurrences: 3 },
      name: 'Too Many Meetings', email: 'series-boundary@schedra.test', timeZone: 'UTC'
    }
  })
  expect(excessive.status()).toBe(400)
  expect(await excessive.text()).toContain('no more than 2 meetings')
})

test('gates personal branding, then applies the paid account brand to public pages on mobile', async ({ page }) => {
  const email = 'brand-host@schedra.test'
  await signUpAndSignIn(page, {
    name: 'Brand Host', username: 'brand-host', email
  })
  await page.goto('/settings')
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('Make the booking page yours', { exact: true })).toBeVisible()
  const denied = await page.request.patch('/api/personal-branding', {
    data: {
      brandName: 'Denied Brand', brandColor: '#123456', brandDarkColor: '#abcdef',
      bookingPageTheme: 'system', hideSchedraBranding: false
    }
  })
  expect(denied.status()).toBe(402)

  await activatePersonalPro(email)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Booking-page branding' })).toBeVisible()
  await expect(page.getByTestId('personal-branding-settings')).toHaveAttribute('data-ready', 'true')
  await page.getByLabel('Brand name').fill('Bright Studio')
  await page.getByLabel('Light-theme colour').last().fill('#123456')
  await page.getByLabel('Dark-theme colour').last().fill('#abcdef')
  await page.getByLabel('Booking-page theme').click()
  await page.getByRole('option', { name: 'Always light' }).click()
  await page.getByRole('switch', { name: 'Remove Schedra branding' }).click()
  await page.getByRole('button', { name: 'Save branding' }).click()
  await expect(page.getByText('Branding saved', { exact: true })).toBeVisible()

  await page.goto('/brand-host')
  await expect(page.getByText('Bright Studio', { exact: true })).toBeVisible()
  await expect(page.getByText('Scheduling by Schedra')).toHaveCount(0)
  await expect(page.locator('.personal-booking-brand')).toHaveCSS('--booking-brand-light', '#123456')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('keeps analytics CSV private to Personal Pro and exports the signed-in host data', async ({ page }) => {
  const email = 'analytics-host@schedra.test'
  await signUpAndSignIn(page, {
    name: 'Analytics Host', username: 'analytics-host', email
  })
  expect((await page.request.get('/api/analytics/export?days=30')).status()).toBe(402)
  await page.goto('/analytics')
  await expect(page.getByRole('link', { name: 'Export CSV' })).toHaveCount(0)

  await activatePersonalPro(email)
  await sql`
    insert into bookings (
      event_type_id, host_id, uid, status, starts_at, ends_at,
      attendee_name, attendee_email, attendee_time_zone, source
    )
    select event_types.id, users.id, ${crypto.randomUUID()}, 'confirmed',
      now() + interval '1 day', now() + interval '1 day 30 minutes',
      'Guest, "Quoted"', 'quoted-guest@schedra.test', 'UTC', 'hosted'
    from users
    inner join event_types on event_types.user_id = users.id
    where users.email = ${email}
    order by event_types.created_at limit 1
  `

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await expect(page.getByRole('link', { name: 'Export CSV' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  const exported = await page.request.get('/api/analytics/export?days=30')
  expect(exported.ok()).toBe(true)
  expect(exported.headers()['content-type']).toContain('text/csv')
  expect(exported.headers()['content-disposition']).toContain('schedra-bookings-')
  expect(exported.headers()['cache-control']).toBe('private, no-store')
  const csv = await exported.text()
  expect(csv.charCodeAt(0)).toBe(0xFEFF)
  expect(csv).toContain('attendanceStatus')
  expect(csv).toContain('"Guest, ""Quoted"""')
  expect(csv).toContain('quoted-guest@schedra.test')
})
