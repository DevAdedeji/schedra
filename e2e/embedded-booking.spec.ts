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

test('shows an interactive overlay preview on the landing page', async ({ page }) => {
  await page.goto('/#embed')
  await expect(page.locator('#embed')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByRole('button', { name: 'Close booking preview' })).toBeVisible()
  const previewTime = page.getByRole('dialog', { name: 'Booking preview' }).getByRole('button', { name: '10:30' })
  await previewTime.click()
  await expect(previewTime).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Close booking preview' }).click()
  await expect(page.getByRole('button', { name: 'Close booking preview' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Book a call' }).click()
  await expect(page.getByRole('button', { name: 'Close booking preview' })).toBeVisible()
})

test('keeps marketing links, pricing controls and public security headers usable', async ({ page, request }) => {
  for (const path of ['/', '/pricing', '/support', '/privacy', '/terms', '/docs/integrations/zoom']) {
    const response = await request.get(path)
    expect(response.ok(), `${path} should load`).toBe(true)
    expect(response.headers()['x-frame-options']).toBe('DENY')
    expect(response.headers()['x-content-type-options']).toBe('nosniff')
  }

  await page.goto('/pricing')
  await expect(page.locator('[data-ready]')).toHaveAttribute('data-ready', 'true')
  const monthly = page.getByRole('button', { name: 'Monthly' })
  await monthly.click()
  await expect(monthly).toHaveAttribute('aria-pressed', 'true')
  await page.getByText('Integrations and distribution', { exact: true }).click()
  await expect(page.getByText('Booking overlay for your website', { exact: true })).toBeVisible()
  await expect(page.getByText('Microsoft Calendar conflict checks and sync', { exact: true })).toBeVisible()
  await page.getByText('Scheduling together', { exact: true }).click()
  await expect(page.getByText('Round-robin assignment', { exact: true })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('#embed')).toHaveAttribute('data-ready', 'true')
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await expect(page.getByRole('link', { name: 'Sign up free' })).toBeVisible()
  await page.locator('header nav').last().getByRole('link', { name: 'Website embeds' }).click()
  await expect(page.locator('#embed')).toBeInViewport()
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

  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(account.email)
  await page.locator('input[name="password"]').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
}

async function openExternalEmbed(page: Page, path: '/personal' | '/team' | '/floating') {
  const attribution = path === '/personal' ? '?utm_source=customer-site&utm_campaign=demo' : ''
  await page.goto(`http://127.0.0.1:3103${path}${attribution}`)
  await page.waitForFunction(() => Boolean((window as Window & { SchedraEmbed?: unknown }).SchedraEmbed))

  const triggerName = path === '/floating' ? 'Book now' : 'Book a demo'
  const trigger = page.getByRole('button', { name: triggerName })
  await trigger.click()

  const overlay = page.locator('[data-schedra-overlay]')
  await expect(overlay).toHaveCount(1)
  await expect(overlay.getByRole('button', { name: 'Close booking' })).toBeFocused()
  await expect.poll(() => page.evaluate(() => document.documentElement.style.overflow)).toBe('hidden')

  return { trigger, overlay, frame: page.frameLocator('[data-schedra-overlay] iframe') }
}

test('generates an embed and completes a personal booking without leaving the customer website', async ({ page, request }) => {
  test.setTimeout(90_000)
  await signUpAndSignIn(page, {
    name: 'Embed Host',
    username: 'embed-host',
    email: 'embed-host@schedra.test'
  })

  await page.goto('/event-types')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'New event type' }).click()
  await page.getByLabel('Event name').fill('Website demo')
  await page.getByLabel('Description').fill('A meeting booked from an embedded overlay.')
  await page.getByRole('button', { name: 'Create event type' }).click()
  await expect(page.getByRole('heading', { name: 'Website demo' })).toBeVisible()

  const personalSitemap = await request.get('/sitemap.xml')
  expect(personalSitemap.ok()).toBe(true)
  expect(await personalSitemap.text()).toContain('/embed-host/website-demo</loc>')

  const websiteDemo = page.getByRole('listitem').filter({
    has: page.getByRole('heading', { name: 'Website demo' })
  })
  await websiteDemo.getByRole('button', { name: 'Actions for Website demo' }).click()
  await page.getByRole('menuitem', { name: 'Embed on website' }).click()
  const generator = page.getByRole('dialog', { name: 'Embed on your website' })
  await expect(generator).toBeVisible()
  await expect(generator).toContainText('data-schedra-embed="http://127.0.0.1:3102/embed-host/website-demo"')
  await generator.getByRole('button', { name: 'Embed type' }).click()
  await page.getByText('Floating button', { exact: true }).click()
  await expect(generator).toContainText('data-schedra-floating=')
  await generator.getByRole('button', { name: 'Preview' }).click()
  const preview = page.getByRole('dialog', { name: 'Preview: Website demo' })
  await expect(preview).toBeVisible()
  await preview.getByRole('button', { name: 'Close' }).click()
  await generator.getByRole('button', { name: 'Close' }).click()

  await page.setViewportSize({ width: 390, height: 844 })
  await websiteDemo.getByRole('button', { name: 'Actions for Website demo' }).click()
  await page.getByRole('menuitem', { name: 'Embed on website' }).click()
  await expect(page.getByRole('dialog', { name: 'Embed on your website' })).toBeVisible()
  await page.getByRole('dialog', { name: 'Embed on your website' }).getByRole('button', { name: 'Close' }).click()
  await page.setViewportSize({ width: 1280, height: 720 })

  const embedScript = await request.get('/embed.js')
  expect(embedScript.ok()).toBe(true)
  expect(embedScript.headers()['cross-origin-resource-policy']).toBe('cross-origin')
  expect(embedScript.headers()['access-control-allow-origin']).toBe('*')

  const embedDocument = await request.get('/embed/personal/embed-host/website-demo')
  expect(embedDocument.ok()).toBe(true)
  expect(embedDocument.headers()['x-frame-options']).toBeUndefined()
  const normalBooking = await request.get('/embed-host/website-demo')
  expect(normalBooking.headers()['x-frame-options']).toBe('DENY')

  const { trigger, overlay, frame } = await openExternalEmbed(page, '/personal')
  expect(new URL(page.url()).origin).toBe('http://127.0.0.1:3103')
  expect(new URL(page.url()).pathname).toBe('/personal')
  await expect(frame.getByText('Website demo', { exact: true })).toBeVisible()
  await frame.getByTestId('booking-slot').first().click()
  await expect(frame.getByLabel('Your name')).toHaveValue('Website Visitor')
  await expect(frame.getByLabel('Email')).toHaveValue('visitor@example.com')
  await frame.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(frame.getByTestId('booking-confirmation')).toContainText('You\'re booked')
  await expect.poll(() => page.evaluate(() => (window as Window & { embedEvents: Array<{ type: string }> }).embedEvents.map(event => event.type))).toContain('booking-completed')

  const [saved] = await sql<{ source: string, attribution: { referrerHost?: string, utmSource?: string, utmCampaign?: string } }[]>`
    select source, attribution from bookings where attendee_email = 'visitor@example.com'
  `
  expect(saved?.source).toBe('embed')
  expect(saved?.attribution).toEqual(expect.objectContaining({
    referrerHost: '127.0.0.1',
    utmSource: 'customer-site',
    utmCampaign: 'demo'
  }))

  await overlay.getByRole('button', { name: 'Close booking' }).click()
  await expect(overlay).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect.poll(() => page.evaluate(() => document.documentElement.style.overflow)).toBe('')

  await page.setViewportSize({ width: 390, height: 844 })
  const mobile = await openExternalEmbed(page, '/floating')
  const dialog = mobile.overlay.getByRole('dialog', { name: 'Book a meeting' })
  const box = await dialog.boundingBox()
  expect(box?.width).toBe(390)
  expect(box?.height).toBe(844)
  await page.keyboard.press('Escape')
  await expect(mobile.overlay).toHaveCount(0)

  const recoverable = await openExternalEmbed(page, '/personal')
  await recoverable.overlay.locator('iframe').evaluate(frame => frame.dispatchEvent(new Event('error')))
  await expect(recoverable.overlay.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as Window & { embedEvents: Array<{ type: string }> }).embedEvents.map(event => event.type))).toContain('error')
  await recoverable.overlay.getByRole('button', { name: 'Try again' }).click()
  await expect(recoverable.frame.getByText('Website demo', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
})

test('books a team event through the same cross-origin overlay', async ({ page, request }) => {
  test.setTimeout(90_000)
  await signUpAndSignIn(page, {
    name: 'Team Embed Owner',
    username: 'team-embed-owner',
    email: 'team-embed-owner@schedra.test'
  })

  await page.getByRole('button', { name: /Current team: Personal\. Switch team/ }).click()
  await page.getByText('Create team', { exact: true }).click()
  await page.getByLabel('Team name').fill('Embed Team')
  await page.getByLabel('Team address').fill('embed-team')
  await page.getByRole('button', { name: 'Create team', exact: true }).click()
  await expect(page).toHaveURL(/\/t\/embed-team\/members$/)

  await page.getByRole('link', { name: 'Event types', exact: true }).click()
  await page.locator('header').getByRole('button', { name: 'New event type' }).click()
  await page.getByLabel('Title').fill('Team demo')
  await page.getByLabel('Description').fill('A team booking from another website.')
  await page.getByRole('checkbox', { name: 'Team Embed Owner as host' }).check()
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByText('Team demo', { exact: true })).toBeVisible()

  const teamSitemap = await request.get('/sitemap.xml')
  expect(teamSitemap.ok()).toBe(true)
  const teamSitemapXml = await teamSitemap.text()
  expect(teamSitemapXml).toContain('/team/embed-team</loc>')
  expect(teamSitemapXml).toContain('/team/embed-team/team-demo</loc>')

  await page.getByRole('button', { name: 'Actions for Team demo' }).click()
  await page.getByText('Embed on website', { exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Embed on your website' })).toContainText('/team/embed-team/team-demo')

  const { frame } = await openExternalEmbed(page, '/team')
  await expect(frame.getByText('Team demo', { exact: true })).toBeVisible()
  await frame.getByTestId('booking-slot').first().click()
  await frame.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(frame.getByTestId('booking-confirmation')).toContainText('You\'re booked')

  const [booking] = await sql<{ organizationId: string }[]>`
    select organization_id as "organizationId"
    from bookings where attendee_email = 'visitor@example.com'
  `
  expect(booking?.organizationId).toBeTruthy()
})
