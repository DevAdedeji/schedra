import { and, count, eq, inArray, isNotNull, lt, notInArray, sql } from 'drizzle-orm'
import {
  bookingPayments,
  operationsAlerts,
  paymentRecipients,
  paymentWithdrawals,
  webhookDeliveries
} from '../database/schema'
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

export interface FinancialAlertCounts {
  expiredPendingPayments: number
  staleRefunds: number
  failedRefunds: number
  failedWithdrawals: number
  unresolvedWithdrawals: number
  restrictedRecipients: number
  ignoredFinancialWebhooks: number
}

export function shouldNotifyOperationsAlert(existing?: {
  status: string
  lastNotifiedAt: Date | null
} | null) {
  if (existing?.status === 'acknowledged') return false
  return !existing || existing.status === 'resolved' || !existing.lastNotifiedAt
}

export async function evaluateOperationsAlerts() {
  const db = useDatabase()
  const overview = await operationsOverview()
  const { automation, calendar, billing, email, webhook } = overview.queues
  const candidates: AlertCandidate[] = []

  if (automation.failed) candidates.push(candidate('automation-failed', 'workflow_automation', 'warning', `${automation.failed} workflow run${automation.failed === 1 ? '' : 's'} could not be delivered`, { count: automation.failed }))
  if (automation.stale) candidates.push(candidate('automation-stale', 'workflow_automation', 'warning', `${automation.stale} workflow run${automation.stale === 1 ? ' is' : 's are'} delayed`, { count: automation.stale, thresholdMinutes: 15 }))
  if (calendar.failed) candidates.push(candidate('calendar-failed', 'calendar_sync', 'critical', `${calendar.failed} calendar update${calendar.failed === 1 ? '' : 's'} need attention`, { count: calendar.failed }))
  if (calendar.stale) candidates.push(candidate('calendar-stale', 'calendar_sync', 'warning', `${calendar.stale} calendar update${calendar.stale === 1 ? ' is' : 's are'} delayed`, { count: calendar.stale, thresholdMinutes: 15 }))
  if (billing.failed) candidates.push(candidate('billing-failed', 'seat_billing', 'critical', `${billing.failed} seat billing update${billing.failed === 1 ? '' : 's'} failed`, { count: billing.failed }))
  if (billing.stale) candidates.push(candidate('billing-stale', 'seat_billing', 'warning', `${billing.stale} seat billing update${billing.stale === 1 ? ' is' : 's are'} delayed`, { count: billing.stale, thresholdMinutes: 15 }))
  if (email.failed) candidates.push(candidate('email-failed', 'email_delivery', 'warning', `${email.failed} email${email.failed === 1 ? '' : 's'} could not be delivered`, { count: email.failed }))
  if (email.stale) candidates.push(candidate('email-stale', 'email_delivery', 'warning', `${email.stale} email${email.stale === 1 ? ' is' : 's are'} delayed`, { count: email.stale, thresholdMinutes: 15 }))
  if (webhook.failed) candidates.push(candidate('webhook-failed', 'webhook', 'critical', `${webhook.failed} webhook${webhook.failed === 1 ? '' : 's'} failed processing`, { count: webhook.failed }))
  if (webhook.stale) candidates.push(candidate('webhook-stale', 'webhook', 'critical', `${webhook.stale} webhook${webhook.stale === 1 ? ' is' : 's are'} stuck processing`, { count: webhook.stale, thresholdMinutes: 15 }))
  candidates.push(...financialAlertCandidates(await financialAlertCounts()))

  const activeKeys = candidates.map(item => item.key)
  if (activeKeys.length) {
    await db.update(operationsAlerts).set({
      status: 'resolved',
      resolvedAt: sql`now()`,
      updatedAt: sql`now()`
    }).where(and(
      inArray(operationsAlerts.status, ['active', 'acknowledged']),
      notInArray(operationsAlerts.key, activeKeys)
    ))
  } else {
    await db.update(operationsAlerts).set({
      status: 'resolved',
      resolvedAt: sql`now()`,
      updatedAt: sql`now()`
    }).where(inArray(operationsAlerts.status, ['active', 'acknowledged']))
  }

  for (const item of candidates) {
    const [existing] = await db.select().from(operationsAlerts)
      .where(eq(operationsAlerts.key, item.key)).limit(1)
    const shouldNotify = shouldNotifyOperationsAlert(existing)
    const incidentStartedAt = !existing || existing.status === 'resolved'
      ? sql<Date>`now()`
      : existing.firstSeenAt

    const [stored] = await db.insert(operationsAlerts).values({
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
        status: existing?.status === 'acknowledged' ? 'acknowledged' : 'active',
        summary: item.summary,
        details: item.details,
        firstSeenAt: incidentStartedAt,
        lastSeenAt: sql`now()`,
        lastNotifiedAt: existing?.lastNotifiedAt ?? null,
        resolvedAt: null,
        updatedAt: sql`now()`
      }
    }).returning({
      firstSeenAt: operationsAlerts.firstSeenAt,
      lastSeenAt: operationsAlerts.lastSeenAt
    })

    if (shouldNotify && stored && await notify(item, stored.lastSeenAt, stored.firstSeenAt)) {
      // Only start the cooldown once the notification has been durably
      // enqueued. A temporary outbox failure must not suppress the alert.
      await db.update(operationsAlerts).set({
        lastNotifiedAt: sql`now()`,
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

export function financialAlertCandidates(financial: FinancialAlertCounts): AlertCandidate[] {
  const items: AlertCandidate[] = []
  if (financial.expiredPendingPayments) items.push(candidate(
    'payments-expired-pending',
    'paid_booking',
    'critical',
    `${financial.expiredPendingPayments} expired checkout${financial.expiredPendingPayments === 1 ? ' is' : 's are'} still pending locally`,
    { count: financial.expiredPendingPayments, thresholdMinutes: 15 }
  ))
  if (financial.staleRefunds) items.push(candidate(
    'payments-refund-stale',
    'refund',
    'critical',
    `${financial.staleRefunds} refund${financial.staleRefunds === 1 ? ' has' : 's have'} been pending for more than 24 hours`,
    { count: financial.staleRefunds, thresholdHours: 24 }
  ))
  if (financial.failedRefunds) items.push(candidate(
    'payments-refund-failed',
    'refund',
    'critical',
    `${financial.failedRefunds} refund${financial.failedRefunds === 1 ? '' : 's'} need manual review`,
    { count: financial.failedRefunds }
  ))
  if (financial.failedWithdrawals) items.push(candidate(
    'payments-withdrawal-failed',
    'withdrawal',
    'critical',
    `${financial.failedWithdrawals} withdrawal${financial.failedWithdrawals === 1 ? '' : 's'} need manual review`,
    { count: financial.failedWithdrawals }
  ))
  if (financial.unresolvedWithdrawals) items.push(candidate(
    'payments-withdrawal-unresolved',
    'withdrawal',
    'critical',
    `${financial.unresolvedWithdrawals} withdrawal request${financial.unresolvedWithdrawals === 1 ? ' has' : 's have'} had an unknown state for more than 15 minutes`,
    { count: financial.unresolvedWithdrawals, thresholdMinutes: 15 }
  ))
  if (financial.restrictedRecipients) items.push(candidate(
    'payments-recipient-restricted',
    'payout_account',
    'warning',
    `${financial.restrictedRecipients} payout account${financial.restrictedRecipients === 1 ? ' is' : 's are'} restricted or disabled`,
    { count: financial.restrictedRecipients }
  ))
  if (financial.ignoredFinancialWebhooks) items.push(candidate(
    'payments-financial-webhook-ignored',
    'payment_webhook',
    'critical',
    `${financial.ignoredFinancialWebhooks} failed payout, dispute or exceptional payment webhook${financial.ignoredFinancialWebhooks === 1 ? ' was' : 's were'} not applied`,
    { count: financial.ignoredFinancialWebhooks, lookbackDays: 7 }
  ))
  return items
}

async function financialAlertCounts(): Promise<FinancialAlertCounts> {
  const db = useDatabase()
  const [
    [expiredPending],
    [staleRefunds],
    [failedRefunds],
    [failedWithdrawals],
    [unresolvedWithdrawals],
    [restrictedRecipients],
    [ignoredFinancialWebhooks]
  ] = await Promise.all([
    db.select({ value: count() }).from(bookingPayments).where(and(
      eq(bookingPayments.status, 'pending'),
      isNotNull(bookingPayments.checkoutExpiresAt),
      lt(bookingPayments.checkoutExpiresAt, sql`now() - interval '15 minutes'`)
    )),
    db.select({ value: count() }).from(bookingPayments).where(and(
      eq(bookingPayments.status, 'refund_pending'),
      lt(bookingPayments.updatedAt, sql`now() - interval '24 hours'`)
    )),
    db.select({ value: count() }).from(bookingPayments)
      .where(eq(bookingPayments.status, 'refund_failed')),
    db.select({ value: count() }).from(paymentWithdrawals)
      .where(eq(paymentWithdrawals.status, 'failed')),
    db.select({ value: count() }).from(paymentWithdrawals).where(and(
      inArray(paymentWithdrawals.status, ['creating', 'unknown']),
      lt(paymentWithdrawals.updatedAt, sql`now() - interval '15 minutes'`)
    )),
    db.select({ value: count() }).from(paymentRecipients).where(and(
      isNotNull(paymentRecipients.bachsAccountId),
      inArray(paymentRecipients.status, ['restricted', 'disabled'])
    )),
    db.select({ value: count() }).from(webhookDeliveries).where(and(
      eq(webhookDeliveries.provider, 'bachs'),
      eq(webhookDeliveries.status, 'ignored'),
      inArray(webhookDeliveries.eventType, [
        'collection.underpaid',
        'collection.overpaid',
        'dispute.created',
        'dispute.updated',
        'refund.paid',
        'refund.failed',
        'payout.failed'
      ]),
      sql`${webhookDeliveries.receivedAt} >= now() - interval '7 days'`
    ))
  ])
  return {
    expiredPendingPayments: expiredPending?.value ?? 0,
    staleRefunds: staleRefunds?.value ?? 0,
    failedRefunds: failedRefunds?.value ?? 0,
    failedWithdrawals: failedWithdrawals?.value ?? 0,
    unresolvedWithdrawals: unresolvedWithdrawals?.value ?? 0,
    restrictedRecipients: restrictedRecipients?.value ?? 0,
    ignoredFinancialWebhooks: ignoredFinancialWebhooks?.value ?? 0
  }
}

function candidate(key: string, type: string, severity: AlertCandidate['severity'], summary: string, details: Record<string, unknown>): AlertCandidate {
  return { key, type, severity, summary, details }
}

async function notify(alert: AlertCandidate, now: Date, incidentStartedAt: Date) {
  const env = useEnv()
  if (!env.operationsAlertEmails.length) {
    logEvent('warn', 'operations_alert_without_recipient', { alertKey: alert.key, severity: alert.severity })
    return false
  }
  await enqueueEmails(env.operationsAlertEmails.map(recipient => ({
    dedupeKey: `operations-alert:${alert.key}:${incidentStartedAt.toISOString()}:${recipient}`,
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
      footer: 'This grouped alert is sent once for this incident. It will not repeat while the condition remains active.'
    }
  })))
  return true
}
