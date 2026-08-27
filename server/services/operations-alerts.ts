import { and, eq, inArray, lt, notInArray, sql } from 'drizzle-orm'
import { operationsAlerts, webhookDeliveries } from '../database/schema'
import { useDatabase } from '../database'
import { useEnv } from '../config/env'
import { enqueueEmails } from './email-outbox'
import { operationsOverview } from './operations'
import { logEvent } from '../observability/logger'

interface AlertCandidate {
  key: string
  type: string
  severity: 'warning' | 'critical'
  summary: string
  details: Record<string, unknown>
}

const NOTIFICATION_COOLDOWN_MS = 60 * 60 * 1000

export async function evaluateOperationsAlerts() {
  const db = useDatabase()
  const overview = await operationsOverview()
  const { calendar, billing, email, webhook } = overview.queues
  const candidates: AlertCandidate[] = []

  if (calendar.failed) candidates.push(candidate('calendar-failed', 'calendar_sync', 'critical', `${calendar.failed} calendar update${calendar.failed === 1 ? '' : 's'} need attention`, { count: calendar.failed }))
  if (calendar.stale) candidates.push(candidate('calendar-stale', 'calendar_sync', 'warning', `${calendar.stale} calendar update${calendar.stale === 1 ? ' is' : 's are'} delayed`, { count: calendar.stale, thresholdMinutes: 15 }))
  if (billing.failed) candidates.push(candidate('billing-failed', 'seat_billing', 'critical', `${billing.failed} seat billing update${billing.failed === 1 ? '' : 's'} failed`, { count: billing.failed }))
  if (billing.stale) candidates.push(candidate('billing-stale', 'seat_billing', 'warning', `${billing.stale} seat billing update${billing.stale === 1 ? ' is' : 's are'} delayed`, { count: billing.stale, thresholdMinutes: 15 }))
  if (email.failed) candidates.push(candidate('email-failed', 'email_delivery', 'warning', `${email.failed} email${email.failed === 1 ? '' : 's'} could not be delivered`, { count: email.failed }))
  if (email.stale) candidates.push(candidate('email-stale', 'email_delivery', 'warning', `${email.stale} email${email.stale === 1 ? ' is' : 's are'} delayed`, { count: email.stale, thresholdMinutes: 15 }))
  if (webhook.failed) candidates.push(candidate('webhook-failed', 'webhook', 'critical', `${webhook.failed} webhook${webhook.failed === 1 ? '' : 's'} failed processing`, { count: webhook.failed }))
  if (webhook.stale) candidates.push(candidate('webhook-stale', 'webhook', 'critical', `${webhook.stale} webhook${webhook.stale === 1 ? ' is' : 's are'} stuck processing`, { count: webhook.stale, thresholdMinutes: 15 }))

  const activeKeys = candidates.map(item => item.key)
  if (activeKeys.length) {
    await db.update(operationsAlerts).set({
      status: 'resolved',
      resolvedAt: sql`now()`,
      updatedAt: sql`now()`
    }).where(and(
      eq(operationsAlerts.status, 'active'),
      notInArray(operationsAlerts.key, activeKeys)
    ))
  } else {
    await db.update(operationsAlerts).set({
      status: 'resolved',
      resolvedAt: sql`now()`,
      updatedAt: sql`now()`
    }).where(eq(operationsAlerts.status, 'active'))
  }

  const now = new Date()
  for (const item of candidates) {
    const [existing] = await db.select().from(operationsAlerts)
      .where(eq(operationsAlerts.key, item.key)).limit(1)
    const shouldNotify = !existing?.lastNotifiedAt
      || now.getTime() - existing.lastNotifiedAt.getTime() >= NOTIFICATION_COOLDOWN_MS

    await db.insert(operationsAlerts).values({
      key: item.key,
      type: item.type,
      severity: item.severity,
      summary: item.summary,
      details: item.details,
      lastNotifiedAt: existing?.lastNotifiedAt ?? null
    }).onConflictDoUpdate({
      target: operationsAlerts.key,
      set: {
        type: item.type,
        severity: item.severity,
        status: 'active',
        summary: item.summary,
        details: item.details,
        lastSeenAt: sql`now()`,
        lastNotifiedAt: existing?.lastNotifiedAt ?? null,
        resolvedAt: null,
        updatedAt: sql`now()`
      }
    })

    if (shouldNotify && await notify(item, now)) {
      // Only start the cooldown once the notification has been durably
      // enqueued. A temporary outbox failure must not suppress the alert.
      await db.update(operationsAlerts).set({
        lastNotifiedAt: now,
        updatedAt: sql`now()`
      }).where(eq(operationsAlerts.key, item.key))
    }
  }

  // Successful payloads are useful briefly for support, but retaining them
  // forever increases the blast radius of a database leak.
  await db.update(webhookDeliveries).set({ payloadEncrypted: null, updatedAt: sql`now()` })
    .where(and(
      inArray(webhookDeliveries.status, ['completed', 'ignored']),
      lt(webhookDeliveries.processedAt, sql`now() - interval '7 days'`),
      sql`${webhookDeliveries.payloadEncrypted} is not null`
    ))
  await db.delete(webhookDeliveries).where(lt(webhookDeliveries.receivedAt, sql`now() - interval '90 days'`))

  return candidates.length
}

function candidate(key: string, type: string, severity: AlertCandidate['severity'], summary: string, details: Record<string, unknown>): AlertCandidate {
  return { key, type, severity, summary, details }
}

async function notify(alert: AlertCandidate, now: Date) {
  const env = useEnv()
  if (!env.operationsAlertEmails.length) {
    logEvent('warn', 'operations_alert_without_recipient', { alertKey: alert.key, severity: alert.severity })
    return false
  }
  const hour = now.toISOString().slice(0, 13)
  await enqueueEmails(env.operationsAlertEmails.map(recipient => ({
    dedupeKey: `operations-alert:${alert.key}:${hour}:${recipient}`,
    email: {
      to: recipient,
      subject: `[${alert.severity.toUpperCase()}] ${alert.summary}`,
      preheader: 'Schedra operations needs attention.',
      heading: 'Schedra operations alert',
      body: `${alert.summary}. Open the private operations dashboard to review the affected records and retry them safely.`,
      details: [
        { label: 'Severity', value: alert.severity },
        { label: 'Detected', value: now.toISOString() }
      ],
      action: { label: 'Open operations', url: `${env.schedraUrl}/operations` },
      footer: 'This alert is grouped and will not repeat more than once per hour while the condition remains active.'
    }
  })))
  return true
}
