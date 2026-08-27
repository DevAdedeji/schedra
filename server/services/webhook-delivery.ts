import { and, eq, sql } from 'drizzle-orm'
import { webhookDeliveries } from '../database/schema'
import { useDatabase } from '../database'
import { decryptCredential, encryptCredential } from '../integrations/calendar/credential-crypto'

export type WebhookProvider = 'bachs' | 'zoom'

export async function claimWebhookDelivery(input: {
  provider: WebhookProvider
  providerEventId: string
  eventType: string
  rawBody: string
  requestId?: string
}) {
  const db = useDatabase()
  const inserted = await db.insert(webhookDeliveries).values({
    provider: input.provider,
    providerEventId: input.providerEventId,
    eventType: input.eventType,
    payloadEncrypted: encryptCredential(input.rawBody),
    requestId: input.requestId
  }).onConflictDoNothing({
    target: [webhookDeliveries.provider, webhookDeliveries.providerEventId],
    // The dedupe index is partial so PostgreSQL needs the matching predicate
    // to infer it as the conflict arbiter.
    where: sql`${webhookDeliveries.providerEventId} is not null`
  }).returning()

  if (inserted[0]) return { delivery: inserted[0], shouldProcess: true, duplicate: false }

  const [existing] = await db.select().from(webhookDeliveries).where(and(
    eq(webhookDeliveries.provider, input.provider),
    eq(webhookDeliveries.providerEventId, input.providerEventId)
  )).limit(1)
  if (!existing) throw new Error('Webhook delivery could not be claimed.')

  if (existing.status === 'failed') {
    const [reopened] = await db.update(webhookDeliveries).set({
      status: 'processing',
      attempts: sql`${webhookDeliveries.attempts} + 1`,
      payloadEncrypted: encryptCredential(input.rawBody),
      requestId: input.requestId,
      lastError: null,
      processedAt: null,
      updatedAt: sql`now()`
    }).where(and(
      eq(webhookDeliveries.id, existing.id),
      eq(webhookDeliveries.status, 'failed')
    )).returning()
    if (reopened) return { delivery: reopened, shouldProcess: true, duplicate: true }
  }

  return { delivery: existing, shouldProcess: false, duplicate: true }
}

export async function completeWebhookDelivery(
  id: string,
  status: 'completed' | 'ignored' = 'completed'
) {
  await useDatabase().update(webhookDeliveries).set({
    status,
    processedAt: sql`now()`,
    lastError: null,
    updatedAt: sql`now()`
  }).where(eq(webhookDeliveries.id, id))
}

export async function failWebhookDelivery(id: string, error: unknown) {
  await useDatabase().update(webhookDeliveries).set({
    status: 'failed',
    processedAt: sql`now()`,
    lastError: String(error instanceof Error ? error.message : error).slice(0, 1000),
    updatedAt: sql`now()`
  }).where(eq(webhookDeliveries.id, id))
}

export async function beginWebhookRetry(id: string) {
  const [delivery] = await useDatabase().update(webhookDeliveries).set({
    status: 'processing',
    attempts: sql`${webhookDeliveries.attempts} + 1`,
    lastError: null,
    processedAt: null,
    updatedAt: sql`now()`
  }).where(and(
    eq(webhookDeliveries.id, id),
    eq(webhookDeliveries.status, 'failed')
  )).returning()
  return delivery ?? null
}

export function webhookPayload(delivery: { payloadEncrypted: string | null }) {
  if (!delivery.payloadEncrypted) throw new Error('This delivery has no retryable payload.')
  return JSON.parse(decryptCredential(delivery.payloadEncrypted)) as unknown
}
