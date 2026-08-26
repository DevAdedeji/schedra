import postgres from 'postgres'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureAppTestEnvironment, getTestDatabaseUrl } from '../../test/helpers/database'

const url = getTestDatabaseUrl()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe.skipIf(!url)('subscription seat reconciliation', () => {
  const sql = postgres(url!, { max: 3, onnotice: () => {} })

  async function configure() {
    configureAppTestEnvironment(url!)
    process.env.BACHS_SECRET_KEY = 'sk_sandbox_test'
    process.env.BACHS_WEBHOOK_SECRET = 'whsec-test'
    vi.stubGlobal('createError', (input: { statusCode: number, statusMessage: string }) => (
      Object.assign(new Error(input.statusMessage), input)
    ))
    const { resetEnv } = await import('../config/env')
    resetEnv()
  }

  async function createTeam(memberCount: number, seatsAtLastInvoice = 1) {
    const [organization] = await sql<{ id: string }[]>`
      insert into organizations (name, slug) values ('Acme', ${`acme-${crypto.randomUUID()}`})
      returning id
    `

    for (let index = 0; index < memberCount; index++) {
      const [user] = await sql<{ id: string }[]>`
        insert into users (email, name, username, email_verified)
        values (
          ${`member-${crypto.randomUUID()}@example.com`},
          ${`Member ${index + 1}`},
          ${`member-${crypto.randomUUID()}`},
          true
        )
        returning id
      `
      await sql`
        insert into members (organization_id, user_id, role)
        values (${organization!.id}, ${user!.id}, ${index === 0 ? 'owner' : 'member'})
      `
    }

    await sql`
      insert into organization_subscriptions (
        organization_id, status, interval, collection_currency,
        collection_method, bachs_subscription_id, seats_at_last_invoice
      ) values (
        ${organization!.id}, 'active', 'monthly', 'USD',
        'charge_automatically', 'sub_live', ${seatsAtLastInvoice}
      )
    `
    await sql`
      insert into subscription_seat_sync_jobs (organization_id)
      values (${organization!.id})
    `

    return organization!.id
  }

  beforeEach(async () => {
    await configure()
    await sql`
      truncate table subscription_seat_sync_jobs, organization_audit_logs,
        organization_subscriptions, members, users, organizations
      restart identity cascade
    `
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete process.env.BACHS_SECRET_KEY
    delete process.env.BACHS_WEBHOOK_SECRET
    const { resetEnv } = await import('../config/env')
    resetEnv()
  })

  afterAll(async () => {
    await sql`
      truncate table subscription_seat_sync_jobs, organization_audit_logs,
        organization_subscriptions, members, users, organizations
      restart identity cascade
    `
    await sql.end()
  })

  it('charges the prorated plan difference as soon as a joined member occupies a seat', async () => {
    const organizationId = await createTeam(2)
    const requests: Array<{ method: string, path: string, body: Record<string, unknown> | null }> = []

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const requestUrl = new URL(input instanceof Request ? input.url : String(input))
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as Record<string, unknown>
        : null
      requests.push({ method, path: requestUrl.pathname, body })

      if (method === 'GET' && requestUrl.pathname.endsWith('/subscriptions/sub_live')) {
        return json({
          id: 'sub_live',
          status: 'active',
          product: { id: 'prod_monthly_1' },
          metadata: { organizationId, seats: '1' }
        })
      }
      if (method === 'GET' && requestUrl.pathname.endsWith('/products')) {
        return json({
          items: [{
            id: 'prod_monthly_2',
            name: 'Two seats',
            metadata: { schedra_plan: 'team_monthly_seats_2', schedra_seats: '2' }
          }],
          pagination: { has_more: false, next_cursor: null }
        })
      }
      if (method === 'PATCH' && requestUrl.pathname.endsWith('/subscriptions/sub_live')) {
        return json({
          id: 'sub_live',
          status: 'active',
          product: { id: body?.product_id ?? 'prod_monthly_2' },
          metadata: body?.metadata ?? { organizationId, seats: '1' }
        })
      }
      return json({ detail: 'Unexpected test request' }, 500)
    }))

    const { processSubscriptionSeatSyncJobs } = await import('../services/subscription-seat-sync')
    expect(await processSubscriptionSeatSyncJobs()).toBe(1)

    const planChange = requests.find(request => request.body?.product_id)
    expect(planChange?.body).toEqual({
      product_id: 'prod_monthly_2',
      proration_behavior: 'invoice_now'
    })
    expect(requests.some(request => (
      request.body?.metadata as Record<string, string> | undefined
    )?.seats === '2')).toBe(true)

    const [subscription] = await sql<{ seats: number }[]>`
      select seats_at_last_invoice as seats from organization_subscriptions
      where organization_id = ${organizationId}
    `
    const [job] = await sql<{ status: string, attempts: number }[]>`
      select status, attempts from subscription_seat_sync_jobs
      where organization_id = ${organizationId}
    `
    expect(subscription?.seats).toBe(2)
    expect(job).toMatchObject({ status: 'completed', attempts: 1 })
  })

  it('keeps a failed provider update durable for an automatic retry', async () => {
    const organizationId = await createTeam(2)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ detail: 'Temporary outage' }, 503)))

    const { processSubscriptionSeatSyncJobs } = await import('../services/subscription-seat-sync')
    expect(await processSubscriptionSeatSyncJobs()).toBe(1)

    const [job] = await sql<{
      status: string
      attempts: number
      available_at: Date
      last_error: string
    }[]>`
      select status, attempts, available_at, last_error
      from subscription_seat_sync_jobs where organization_id = ${organizationId}
    `
    expect(job?.status).toBe('pending')
    expect(job?.attempts).toBe(1)
    expect(job?.available_at.getTime()).toBeGreaterThan(Date.now())
    expect(job?.last_error).toContain('Temporary outage')
  })

  it('refuses to multiply a legacy quantity-based subscription charge', async () => {
    const organizationId = await createTeam(3, 2)
    const fetchMock = vi.fn().mockResolvedValue(json({
      id: 'sub_live',
      status: 'active',
      quantity: 2,
      product: { id: 'legacy_per_seat_product' },
      metadata: { organizationId, seats: '2' }
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { processSubscriptionSeatSyncJobs } = await import('../services/subscription-seat-sync')
    expect(await processSubscriptionSeatSyncJobs()).toBe(1)

    const [job] = await sql<{ status: string, last_error: string }[]>`
      select status, last_error from subscription_seat_sync_jobs
      where organization_id = ${organizationId}
    `
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(job?.status).toBe('pending')
    expect(job?.last_error).toContain('legacy subscription')
  })

  it('does not charge again when a legacy subscription already covers every member', async () => {
    const organizationId = await createTeam(2, 1)
    const fetchMock = vi.fn().mockResolvedValue(json({
      id: 'sub_live',
      status: 'active',
      quantity: 2,
      product: { id: 'legacy_per_seat_product' },
      metadata: { organizationId, seats: '2' }
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { processSubscriptionSeatSyncJobs } = await import('../services/subscription-seat-sync')
    expect(await processSubscriptionSeatSyncJobs()).toBe(1)

    const [subscription] = await sql<{ seats: number }[]>`
      select seats_at_last_invoice as seats from organization_subscriptions
      where organization_id = ${organizationId}
    `
    const [job] = await sql<{ status: string }[]>`
      select status from subscription_seat_sync_jobs where organization_id = ${organizationId}
    `
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(subscription?.seats).toBe(2)
    expect(job?.status).toBe('completed')
  })
})
