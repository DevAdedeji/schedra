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
    await sql`truncate table webhook_deliveries, operations_alerts restart identity cascade`
  })

  afterAll(async () => {
    await sql`truncate table webhook_deliveries, operations_alerts restart identity cascade`
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
})
