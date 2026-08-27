import { and, count, desc, eq, sql } from 'drizzle-orm'
import { paginationMeta } from '#shared/pagination'
import {
  bookings,
  calendarSyncJobs,
  emailOutbox,
  eventTypes,
  operationsAlerts,
  organizations,
  subscriptionSeatSyncJobs,
  webhookDeliveries
} from '../database/schema'
import { useDatabase } from '../database'
import { completeWebhookDelivery, failWebhookDelivery, beginWebhookRetry, webhookPayload } from './webhook-delivery'
import { processBachsWebhook, type BachsEvent } from './webhooks/bachs'
import { processZoomWebhook } from './webhooks/zoom'
import { useEnv } from '../config/env'

export type OperationKind = 'calendar' | 'billing' | 'email' | 'webhook'
export type OperationStatus = 'all' | 'pending' | 'processing' | 'completed' | 'failed' | 'ignored'

function maskEmail(value: string) {
  const [local, domain] = value.split('@')
  return domain ? `${local?.slice(0, 2) ?? ''}***@${domain}` : 'Hidden recipient'
}

export async function operationsOverview() {
  const db = useDatabase()
  const [calendar, billing, email, webhooks, alerts] = await Promise.all([
    db.select({
      pending: sql<number>`count(*) filter (where ${calendarSyncJobs.status} = 'pending')`.mapWith(Number),
      processing: sql<number>`count(*) filter (where ${calendarSyncJobs.status} = 'processing')`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${calendarSyncJobs.status} = 'failed')`.mapWith(Number),
      stale: sql<number>`count(*) filter (where ${calendarSyncJobs.status} in ('pending', 'processing') and ${calendarSyncJobs.updatedAt} < now() - interval '15 minutes')`.mapWith(Number)
    }).from(calendarSyncJobs),
    db.select({
      pending: sql<number>`count(*) filter (where ${subscriptionSeatSyncJobs.status} = 'pending')`.mapWith(Number),
      processing: sql<number>`count(*) filter (where ${subscriptionSeatSyncJobs.status} = 'processing')`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${subscriptionSeatSyncJobs.status} = 'failed')`.mapWith(Number),
      stale: sql<number>`count(*) filter (where ${subscriptionSeatSyncJobs.status} in ('pending', 'processing') and ${subscriptionSeatSyncJobs.updatedAt} < now() - interval '15 minutes')`.mapWith(Number)
    }).from(subscriptionSeatSyncJobs),
    db.select({
      pending: sql<number>`count(*) filter (where ${emailOutbox.status} = 'pending')`.mapWith(Number),
      processing: sql<number>`count(*) filter (where ${emailOutbox.status} = 'sending')`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${emailOutbox.status} = 'failed')`.mapWith(Number),
      stale: sql<number>`count(*) filter (where ${emailOutbox.status} in ('pending', 'sending') and ${emailOutbox.updatedAt} < now() - interval '15 minutes')`.mapWith(Number)
    }).from(emailOutbox),
    db.select({
      processing: sql<number>`count(*) filter (where ${webhookDeliveries.status} = 'processing')`.mapWith(Number),
      completed: sql<number>`count(*) filter (where ${webhookDeliveries.status} = 'completed')`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${webhookDeliveries.status} = 'failed')`.mapWith(Number),
      ignored: sql<number>`count(*) filter (where ${webhookDeliveries.status} = 'ignored')`.mapWith(Number),
      stale: sql<number>`count(*) filter (where ${webhookDeliveries.status} = 'processing' and ${webhookDeliveries.updatedAt} < now() - interval '15 minutes')`.mapWith(Number)
    }).from(webhookDeliveries),
    db.select().from(operationsAlerts)
      .where(eq(operationsAlerts.status, 'active'))
      .orderBy(desc(operationsAlerts.lastSeenAt))
      .limit(20)
  ])

  return {
    queues: {
      calendar: calendar[0] ?? { pending: 0, processing: 0, failed: 0, stale: 0 },
      billing: billing[0] ?? { pending: 0, processing: 0, failed: 0, stale: 0 },
      email: email[0] ?? { pending: 0, processing: 0, failed: 0, stale: 0 },
      webhook: webhooks[0] ?? { processing: 0, completed: 0, failed: 0, ignored: 0, stale: 0 }
    },
    alerts: alerts.map(alert => ({
      id: alert.id,
      type: alert.type,
      severity: alert.severity,
      summary: alert.summary,
      details: alert.details,
      firstSeenAt: alert.firstSeenAt.toISOString(),
      lastSeenAt: alert.lastSeenAt.toISOString()
    }))
  }
}

function statusWhere<TStatus extends string>(column: Parameters<typeof eq>[0], status: OperationStatus, mapping: Record<string, TStatus>) {
  if (status === 'all') return undefined
  const mapped = mapping[status]
  return mapped ? eq(column, mapped) : sql`false`
}

export async function operationsJobs(input: {
  kind: OperationKind
  status: OperationStatus
  page: number
  pageSize: number
}) {
  const db = useDatabase()
  const { kind, status, page, pageSize } = input
  const offset = (page - 1) * pageSize

  if (kind === 'calendar') {
    const where = statusWhere(calendarSyncJobs.status, status, {
      pending: 'pending', processing: 'processing', completed: 'completed', failed: 'failed'
    })
    const [[total], rows] = await Promise.all([
      db.select({ value: count() }).from(calendarSyncJobs).where(where),
      db.select({
        id: calendarSyncJobs.id,
        status: calendarSyncJobs.status,
        attempts: calendarSyncJobs.attempts,
        availableAt: calendarSyncJobs.availableAt,
        lastError: calendarSyncJobs.lastError,
        provider: calendarSyncJobs.failureProvider,
        createdAt: calendarSyncJobs.createdAt,
        updatedAt: calendarSyncJobs.updatedAt,
        uid: bookings.uid,
        title: eventTypes.title
      }).from(calendarSyncJobs)
        .innerJoin(bookings, eq(bookings.id, calendarSyncJobs.bookingId))
        .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
        .where(where).orderBy(desc(calendarSyncJobs.updatedAt)).limit(pageSize).offset(offset)
    ])
    return pageResult(rows.map(row => ({
      ...baseRow(row),
      kind,
      provider: row.provider,
      label: `${row.title} · ${row.uid}`,
      retryable: row.status === 'failed'
    })), total?.value ?? 0, page, pageSize)
  }

  if (kind === 'billing') {
    const where = statusWhere(subscriptionSeatSyncJobs.status, status, {
      pending: 'pending', processing: 'processing', completed: 'completed', failed: 'failed'
    })
    const [[total], rows] = await Promise.all([
      db.select({ value: count() }).from(subscriptionSeatSyncJobs).where(where),
      db.select({
        id: subscriptionSeatSyncJobs.id,
        status: subscriptionSeatSyncJobs.status,
        attempts: subscriptionSeatSyncJobs.attempts,
        availableAt: subscriptionSeatSyncJobs.availableAt,
        lastError: subscriptionSeatSyncJobs.lastError,
        createdAt: subscriptionSeatSyncJobs.createdAt,
        updatedAt: subscriptionSeatSyncJobs.updatedAt,
        name: organizations.name
      }).from(subscriptionSeatSyncJobs)
        .innerJoin(organizations, eq(organizations.id, subscriptionSeatSyncJobs.organizationId))
        .where(where).orderBy(desc(subscriptionSeatSyncJobs.updatedAt)).limit(pageSize).offset(offset)
    ])
    return pageResult(rows.map(row => ({
      ...baseRow(row), kind, provider: 'bachs', label: row.name, retryable: row.status === 'failed'
    })), total?.value ?? 0, page, pageSize)
  }

  if (kind === 'email') {
    const where = status === 'processing'
      ? eq(emailOutbox.status, 'sending')
      : statusWhere(emailOutbox.status, status, {
          pending: 'pending', completed: 'sent', failed: 'failed'
        })
    const [[total], rows] = await Promise.all([
      db.select({ value: count() }).from(emailOutbox).where(where),
      db.select({
        id: emailOutbox.id,
        status: emailOutbox.status,
        attempts: emailOutbox.attempts,
        availableAt: emailOutbox.availableAt,
        lastError: emailOutbox.lastError,
        recipient: emailOutbox.recipient,
        subject: emailOutbox.subject,
        createdAt: emailOutbox.createdAt,
        updatedAt: emailOutbox.updatedAt
      }).from(emailOutbox).where(where)
        .orderBy(desc(emailOutbox.updatedAt)).limit(pageSize).offset(offset)
    ])
    return pageResult(rows.map(row => ({
      ...baseRow({ ...row, status: row.status === 'sending' ? 'processing' : row.status === 'sent' ? 'completed' : row.status }),
      kind,
      provider: 'email',
      label: `${row.subject} · ${maskEmail(row.recipient)}`,
      retryable: row.status === 'failed'
    })), total?.value ?? 0, page, pageSize)
  }

  const where = statusWhere(webhookDeliveries.status, status, {
    processing: 'processing', completed: 'completed', failed: 'failed', ignored: 'ignored'
  })
  const [[total], rows] = await Promise.all([
    db.select({ value: count() }).from(webhookDeliveries).where(where),
    db.select().from(webhookDeliveries).where(where)
      .orderBy(desc(webhookDeliveries.receivedAt)).limit(pageSize).offset(offset)
  ])
  return pageResult(rows.map(row => ({
    ...baseRow({ ...row, availableAt: row.receivedAt }),
    kind,
    provider: row.provider,
    label: row.eventType,
    retryable: row.status === 'failed'
  })), total?.value ?? 0, page, pageSize)
}

function baseRow(row: {
  id: string
  status: string
  attempts: number
  availableAt: Date
  lastError: string | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: row.id,
    status: row.status,
    attempts: row.attempts,
    availableAt: row.availableAt.toISOString(),
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

function pageResult<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, pagination: paginationMeta(total, page, pageSize) }
}

export async function retryOperation(kind: OperationKind, id: string) {
  const db = useDatabase()
  if (kind === 'calendar') {
    const rows = await db.update(calendarSyncJobs).set({
      status: 'pending', attempts: 0, availableAt: sql`now()`, lockedAt: null,
      completedAt: null, lastError: null, failureProvider: null, updatedAt: sql`now()`
    }).where(and(eq(calendarSyncJobs.id, id), eq(calendarSyncJobs.status, 'failed'))).returning({ id: calendarSyncJobs.id })
    return Boolean(rows.length)
  }
  if (kind === 'billing') {
    const rows = await db.update(subscriptionSeatSyncJobs).set({
      status: 'pending', attempts: 0, availableAt: sql`now()`, lockedAt: null,
      completedAt: null, lastError: null, updatedAt: sql`now()`
    }).where(and(eq(subscriptionSeatSyncJobs.id, id), eq(subscriptionSeatSyncJobs.status, 'failed')))
      .returning({ id: subscriptionSeatSyncJobs.id })
    return Boolean(rows.length)
  }
  if (kind === 'email') {
    const rows = await db.update(emailOutbox).set({
      status: 'pending', attempts: 0, availableAt: sql`now()`, lockedAt: null,
      sentAt: null, lastError: null, updatedAt: sql`now()`
    }).where(and(eq(emailOutbox.id, id), eq(emailOutbox.status, 'failed'))).returning({ id: emailOutbox.id })
    return Boolean(rows.length)
  }

  const delivery = await beginWebhookRetry(id)
  if (!delivery) return false
  try {
    const payload = webhookPayload(delivery)
    const result = delivery.provider === 'bachs'
      ? await processBachsWebhook(payload as BachsEvent)
      : delivery.provider === 'zoom'
        ? await processZoomWebhook(payload)
        : null
    if (!result) throw new Error('Unsupported webhook provider.')
    await completeWebhookDelivery(delivery.id, 'ignored' in result ? 'ignored' : 'completed')
    return true
  } catch (error) {
    await failWebhookDelivery(delivery.id, error)
    throw error
  }
}

export async function operationsDiagnostics() {
  const startedAt = performance.now()
  await useDatabase().execute(sql`select 1`)
  const env = useEnv()
  return {
    database: { ok: true, latencyMs: Math.round((performance.now() - startedAt) * 10) / 10 },
    configuration: {
      email: env.emailDeliveryMode !== 'log',
      google: Boolean(env.googleClientId && env.googleClientSecret),
      microsoft: Boolean(env.microsoftClientId && env.microsoftClientSecret),
      zoom: Boolean(env.zoomClientId && env.zoomClientSecret && env.zoomWebhookSecret),
      bachs: Boolean(env.bachsSecretKey && env.bachsWebhookSecret),
      alertRecipients: env.operationsAlertEmails.length
    }
  }
}
