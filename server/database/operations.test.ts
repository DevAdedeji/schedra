import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { configureAppTestEnvironment, getTestDatabaseUrl } from '../../test/helpers/database'

const url = getTestDatabaseUrl()

describe.skipIf(!url)('operations and durable webhooks', () => {
  const sql = postgres(url!, { max: 3, onnotice: () => {} })

  beforeEach(async () => {
    configureAppTestEnvironment(url!)
    const { resetEnv } = await import('../config/env')
    resetEnv()
    await sql`truncate table webhook_deliveries, operations_alerts, email_outbox restart identity cascade`
  })

  afterAll(async () => {
    await sql`truncate table webhook_deliveries, operations_alerts, email_outbox restart identity cascade`
    await sql.end()
  })

  it('deduplicates completed provider events', async () => {
    const { claimWebhookDelivery, completeWebhookDelivery } = await import('../services/webhook-delivery')
    const first = await claimWebhookDelivery({
      provider: 'bachs',
      providerEventId: 'evt-completed',
      eventType: 'invoice.paid',
      rawBody: JSON.stringify({ id: 'evt-completed', type: 'invoice.paid' })
    })
    expect(first.shouldProcess).toBe(true)
    await completeWebhookDelivery(first.delivery.id)

    const duplicate = await claimWebhookDelivery({
      provider: 'bachs',
      providerEventId: 'evt-completed',
      eventType: 'invoice.paid',
      rawBody: JSON.stringify({ id: 'evt-completed', type: 'invoice.paid' })
    })
    expect(duplicate).toMatchObject({ shouldProcess: false, duplicate: true })
    expect(duplicate.delivery.status).toBe('completed')
  })

  it('reopens a failed delivery and increments its attempt safely', async () => {
    const { claimWebhookDelivery, failWebhookDelivery } = await import('../services/webhook-delivery')
    const first = await claimWebhookDelivery({
      provider: 'zoom',
      providerEventId: 'zoom:1',
      eventType: 'app_deauthorized',
      rawBody: JSON.stringify({ event: 'app_deauthorized' })
    })
    await failWebhookDelivery(first.delivery.id, new Error('Temporary provider failure'))

    const retry = await claimWebhookDelivery({
      provider: 'zoom',
      providerEventId: 'zoom:1',
      eventType: 'app_deauthorized',
      rawBody: JSON.stringify({ event: 'app_deauthorized' })
    })
    expect(retry).toMatchObject({ shouldProcess: true, duplicate: true })
    expect(retry.delivery.attempts).toBe(2)
    expect(retry.delivery.status).toBe('processing')
  })

  it('manually retries encrypted webhook payloads without exposing them', async () => {
    const { claimWebhookDelivery, failWebhookDelivery } = await import('../services/webhook-delivery')
    const { retryOperation } = await import('../services/operations')
    const delivery = await claimWebhookDelivery({
      provider: 'bachs',
      providerEventId: 'evt-retry',
      eventType: 'unhandled.event',
      rawBody: JSON.stringify({ id: 'evt-retry', type: 'unhandled.event' })
    })
    await failWebhookDelivery(delivery.delivery.id, new Error('Simulated first attempt'))

    await expect(retryOperation('webhook', delivery.delivery.id)).resolves.toBe(true)
    const [stored] = await sql<{ status: string, attempts: number, payload_encrypted: string }[]>`
      select status, attempts, payload_encrypted from webhook_deliveries where id = ${delivery.delivery.id}
    `
    expect(stored).toMatchObject({ status: 'ignored', attempts: 2 })
    expect(stored!.payload_encrypted).not.toContain('evt-retry')
  })

  it('groups failures into one active alert instead of sending per-record noise', async () => {
    await sql`
      insert into webhook_deliveries (
        provider, provider_event_id, event_type, status, attempts, last_error
      ) values
        ('bachs', 'failed-1', 'invoice.paid', 'failed', 1, 'failed'),
        ('bachs', 'failed-2', 'invoice.paid', 'failed', 1, 'failed')
    `
    const { evaluateOperationsAlerts } = await import('../services/operations-alerts')
    await expect(evaluateOperationsAlerts()).resolves.toBe(1)
    await expect(evaluateOperationsAlerts()).resolves.toBe(1)

    const alerts = await sql<{ key: string, status: string, summary: string, last_notified_at: Date | null }[]>`
      select key, status, summary, last_notified_at from operations_alerts
    `
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ key: 'webhook-failed', status: 'active' })
    expect(alerts[0]!.summary).toContain('2 webhooks')
    expect(alerts[0]!.last_notified_at).toBeNull()
  })

  it('keeps a checked alert hidden until the incident clears, then surfaces a new incident', async () => {
    await sql`
      insert into webhook_deliveries (
        provider, provider_event_id, event_type, status, attempts, last_error
      ) values ('bachs', 'checked-incident', 'invoice.paid', 'failed', 1, 'failed')
    `
    const { evaluateOperationsAlerts } = await import('../services/operations-alerts')
    const { acknowledgeOperationsAlert } = await import('../services/operations')
    await evaluateOperationsAlerts()
    const [active] = await sql<{ id: string }[]>`
      select id from operations_alerts where key = 'webhook-failed'
    `
    await expect(acknowledgeOperationsAlert(active!.id)).resolves.toBe(true)
    await evaluateOperationsAlerts()
    await expect(sql<{ status: string }[]>`
      select status from operations_alerts where key = 'webhook-failed'
    `).resolves.toMatchObject([{ status: 'acknowledged' }])

    await sql`
      update webhook_deliveries
      set status = 'completed', processed_at = now()
      where provider_event_id = 'checked-incident'
    `
    await evaluateOperationsAlerts()
    await expect(sql<{ status: string }[]>`
      select status from operations_alerts where key = 'webhook-failed'
    `).resolves.toMatchObject([{ status: 'resolved' }])

    await sql`
      insert into webhook_deliveries (
        provider, provider_event_id, event_type, status, attempts, last_error
      ) values ('bachs', 'new-incident', 'invoice.paid', 'failed', 1, 'failed')
    `
    await evaluateOperationsAlerts()
    await expect(sql<{ status: string }[]>`
      select status from operations_alerts where key = 'webhook-failed'
    `).resolves.toMatchObject([{ status: 'active' }])
  })

  it('enqueues one notification for an active incident instead of repeating it', async () => {
    process.env.OPERATIONS_ALERT_EMAILS = 'ops@example.com'
    const { resetEnv } = await import('../config/env')
    resetEnv()
    try {
      await sql`
        insert into webhook_deliveries (
          provider, provider_event_id, event_type, status, attempts, last_error
        ) values ('bachs', 'failed-once', 'invoice.paid', 'failed', 1, 'failed')
      `
      const { evaluateOperationsAlerts } = await import('../services/operations-alerts')
      await evaluateOperationsAlerts()
      await evaluateOperationsAlerts()

      const [result] = await sql<{ count: number }[]>`
        select count(*)::int as count
        from email_outbox
        where dedupe_key like 'operations-alert:webhook-failed:%'
      `
      expect(result?.count).toBe(1)
    } finally {
      delete process.env.OPERATIONS_ALERT_EMAILS
      resetEnv()
    }
  })

  it('keeps future scheduled emails out of delayed recovery', async () => {
    const [scheduled] = await sql<{ id: string }[]>`
      insert into email_outbox (
        dedupe_key, recipient, subject, heading, body, action_label, action_url,
        available_at, updated_at
      ) values (
        'future-reminder', 'guest@example.com', 'Future reminder', 'Reminder',
        'Your meeting is tomorrow.', 'View booking', 'https://schedra.xyz/booking/test',
        now() + interval '1 day', now() - interval '1 day'
      )
      returning id
    `
    const { operationsJobs, operationsOverview, retryOperation } = await import('../services/operations')

    const overview = await operationsOverview()
    expect(overview.queues.email).toMatchObject({ pending: 1, stale: 0 })

    const jobs = await operationsJobs({ kind: 'email', status: 'all', page: 1, pageSize: 10 })
    expect(jobs.items).toMatchObject([{ id: scheduled!.id, delayed: false, retryable: false }])
    await expect(retryOperation('email', scheduled!.id)).resolves.toBe(false)
  })
})
