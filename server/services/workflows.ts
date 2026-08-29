import { createHmac, randomBytes } from 'node:crypto'
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'
import type { WorkflowAction, WorkflowInput, WorkflowTrigger } from '#shared/workflows'
import type { Database } from '../database/client'
import {
  automationRuns,
  automationWorkflows,
  bookingHosts,
  bookings,
  domainEvents,
  eventTypes,
  organizations,
  users
} from '../database/schema'
import { useDatabase } from '../database'
import { decryptCredential, encryptCredential } from '../integrations/calendar/credential-crypto'
import { fetchWithTimeout } from '../integrations/fetch'
import { enqueueEmails, emailDedupeKey } from './email-outbox'
import { validateWebhookDestination } from './outbound-webhook'
import { useEnv } from '../config/env'
import { logEvent } from '../observability/logger'
import { paginationMeta } from '#shared/pagination'
import { addToInstant, subtractFromInstant, unixSeconds } from '../utils/date-time'

export type WorkflowScope = { userId: string, organizationId?: never } | { organizationId: string, userId?: never }
export type WorkflowExecutor = Pick<Database, 'insert' | 'update'>

class WorkflowServiceError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message)
    this.name = 'WorkflowServiceError'
  }
}

export type PublishBookingEventInput = WorkflowScope & {
  type: Exclude<WorkflowTrigger, 'before_start' | 'after_end'>
  bookingId: string
  eventTypeId: string
  payload?: Record<string, unknown>
}

export async function publishBookingEvent(
  input: PublishBookingEventInput,
  executor: WorkflowExecutor = useDatabase()
) {
  await executor.insert(domainEvents).values({
    dedupeKey: `booking:${input.bookingId}:${input.type}`,
    type: input.type,
    userId: input.userId ?? null,
    organizationId: input.organizationId ?? null,
    bookingId: input.bookingId,
    eventTypeId: input.eventTypeId,
    payload: input.payload ?? {}
  }).onConflictDoNothing({ target: domainEvents.dedupeKey })
}

export async function cancelPendingAutomationRuns(
  bookingId: string,
  executor: Pick<Database, 'update'> = useDatabase()
) {
  await executor.update(automationRuns).set({
    status: 'cancelled',
    lockedAt: null,
    updatedAt: sql`now()`
  }).where(and(
    eq(automationRuns.bookingId, bookingId),
    inArray(automationRuns.status, ['pending', 'processing'])
  ))
}

function scopeWhere(scope: WorkflowScope) {
  return scope.organizationId
    ? eq(automationWorkflows.organizationId, scope.organizationId)
    : eq(automationWorkflows.userId, scope.userId!)
}

export async function listWorkflows(scope: WorkflowScope, page: number, pageSize: number) {
  const db = useDatabase()
  const where = scopeWhere(scope)
  const [[total], rows] = await Promise.all([
    db.select({ value: count() }).from(automationWorkflows).where(where),
    db.select({
      id: automationWorkflows.id,
      name: automationWorkflows.name,
      trigger: automationWorkflows.trigger,
      offsetMinutes: automationWorkflows.offsetMinutes,
      action: automationWorkflows.action,
      active: automationWorkflows.active,
      eventTypeId: automationWorkflows.eventTypeId,
      eventTypeTitle: eventTypes.title,
      createdAt: automationWorkflows.createdAt,
      updatedAt: automationWorkflows.updatedAt
    }).from(automationWorkflows)
      .leftJoin(eventTypes, eq(eventTypes.id, automationWorkflows.eventTypeId))
      .where(where)
      .orderBy(desc(automationWorkflows.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
  ])

  return {
    items: rows.map(row => ({
      ...row,
      webhookConfigured: row.action.type === 'webhook',
      action: row.action.type === 'webhook' ? { type: 'webhook' as const, url: row.action.url } : row.action,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    })),
    pagination: paginationMeta(total?.value ?? 0, page, pageSize)
  }
}

export async function createWorkflow(scope: WorkflowScope, createdByUserId: string, input: WorkflowInput) {
  const db = useDatabase()
  const [total] = await db.select({ value: count() }).from(automationWorkflows).where(scopeWhere(scope))
  if ((total?.value ?? 0) >= 50) {
    throw new WorkflowServiceError(409, 'This workspace has reached the 50 workflow limit.')
  }
  await assertEventTypeInScope(scope, input.eventTypeId)
  const webhookSecret = input.action.type === 'webhook' ? `whsec_${randomBytes(32).toString('base64url')}` : null
  if (input.action.type === 'webhook') await validateWebhookDestination(input.action.url)

  const [created] = await db.insert(automationWorkflows).values({
    userId: scope.userId ?? null,
    organizationId: scope.organizationId ?? null,
    createdByUserId,
    eventTypeId: input.eventTypeId,
    name: input.name,
    trigger: input.trigger,
    offsetMinutes: input.offsetMinutes,
    action: input.action,
    webhookSecretEncrypted: webhookSecret ? encryptCredential(webhookSecret) : null,
    active: input.active
  }).returning({ id: automationWorkflows.id })
  if (!created) throw new Error('Workflow insert did not return a record.')
  await rebuildScheduledRuns(created.id)
  return { id: created.id, webhookSecret }
}

export async function updateWorkflow(scope: WorkflowScope, id: string, input: WorkflowInput) {
  const db = useDatabase()
  await assertEventTypeInScope(scope, input.eventTypeId)
  if (input.action.type === 'webhook') await validateWebhookDestination(input.action.url)

  const [existing] = await db.select({
    id: automationWorkflows.id,
    webhookSecretEncrypted: automationWorkflows.webhookSecretEncrypted
  }).from(automationWorkflows).where(and(eq(automationWorkflows.id, id), scopeWhere(scope))).limit(1)
  if (!existing) return null

  const webhookSecret = input.action.type === 'webhook' && !existing.webhookSecretEncrypted
    ? `whsec_${randomBytes(32).toString('base64url')}`
    : null

  await db.update(automationWorkflows).set({
    eventTypeId: input.eventTypeId,
    name: input.name,
    trigger: input.trigger,
    offsetMinutes: input.offsetMinutes,
    action: input.action,
    webhookSecretEncrypted: input.action.type === 'webhook'
      ? existing.webhookSecretEncrypted ?? encryptCredential(webhookSecret!)
      : null,
    active: input.active,
    updatedAt: sql`now()`
  }).where(eq(automationWorkflows.id, id))
  await rebuildScheduledRuns(id)
  return { id, webhookSecret }
}

export async function setWorkflowActive(scope: WorkflowScope, id: string, active: boolean) {
  const [updated] = await useDatabase().update(automationWorkflows).set({
    active,
    updatedAt: sql`now()`
  }).where(and(eq(automationWorkflows.id, id), scopeWhere(scope))).returning({ id: automationWorkflows.id })
  if (!updated) return false
  if (active) await rebuildScheduledRuns(id)
  else await useDatabase().update(automationRuns).set({ status: 'cancelled', updatedAt: sql`now()` })
    .where(and(eq(automationRuns.workflowId, id), eq(automationRuns.status, 'pending')))
  return true
}

export async function deleteWorkflow(scope: WorkflowScope, id: string) {
  const [deleted] = await useDatabase().delete(automationWorkflows)
    .where(and(eq(automationWorkflows.id, id), scopeWhere(scope)))
    .returning({ id: automationWorkflows.id })
  return Boolean(deleted)
}

async function assertEventTypeInScope(scope: WorkflowScope, eventTypeId: string | null) {
  if (!eventTypeId) return
  const owned = scope.organizationId
    ? eq(eventTypes.organizationId, scope.organizationId)
    : eq(eventTypes.userId, scope.userId!)
  const [eventType] = await useDatabase().select({ id: eventTypes.id }).from(eventTypes)
    .where(and(eq(eventTypes.id, eventTypeId), owned)).limit(1)
  if (!eventType) throw new WorkflowServiceError(400, 'Choose an event type from this workspace.')
}

async function rebuildScheduledRuns(workflowId: string) {
  const db = useDatabase()
  const [workflow] = await db.select().from(automationWorkflows)
    .where(eq(automationWorkflows.id, workflowId)).limit(1)
  if (!workflow) return

  await db.delete(automationRuns).where(and(
    eq(automationRuns.workflowId, workflowId),
    inArray(automationRuns.status, ['pending', 'failed', 'cancelled'])
  ))
  if (!workflow.active || !['before_start', 'after_end'].includes(workflow.trigger)) return

  const scope = workflow.organizationId
    ? eq(bookings.organizationId, workflow.organizationId)
    : and(isNull(bookings.organizationId), eq(bookings.hostId, workflow.userId!))
  const rows = await db.select({ id: bookings.id, startsAt: bookings.startsAt, endsAt: bookings.endsAt })
    .from(bookings)
    .where(and(
      scope,
      eq(bookings.status, 'confirmed'),
      workflow.eventTypeId ? eq(bookings.eventTypeId, workflow.eventTypeId) : undefined,
      workflow.trigger === 'before_start' ? gt(bookings.startsAt, new Date()) : gt(bookings.endsAt, new Date())
    ))

  if (!rows.length) return
  await db.insert(automationRuns).values(rows.map(booking => ({
    workflowId,
    bookingId: booking.id,
    availableAt: workflow.trigger === 'before_start'
      ? subtractFromInstant(booking.startsAt, { minutes: workflow.offsetMinutes })
      : addToInstant(booking.endsAt, { minutes: workflow.offsetMinutes })
  }))).onConflictDoNothing()
}

export async function dispatchDomainEvents(batchSize = 50) {
  const db = useDatabase()
  return db.transaction(async (tx) => {
    const events = await tx.select().from(domainEvents)
      .where(isNull(domainEvents.dispatchedAt))
      .orderBy(asc(domainEvents.occurredAt))
      .limit(batchSize)
      .for('update', { skipLocked: true })
    if (!events.length) return 0

    for (const event of events) {
      const [booking] = event.bookingId
        ? await tx.select({
            id: bookings.id,
            status: bookings.status,
            startsAt: bookings.startsAt,
            endsAt: bookings.endsAt
          }).from(bookings).where(eq(bookings.id, event.bookingId)).limit(1)
        : []

      if (!booking) {
        await tx.update(domainEvents).set({ dispatchedAt: sql`now()`, updatedAt: sql`now()` })
          .where(eq(domainEvents.id, event.id))
        continue
      }

      const directTrigger = event.type as WorkflowTrigger
      const includeTimed = ['booking_created', 'booking_approved', 'booking_rescheduled'].includes(event.type)
        && booking.status === 'confirmed'
      const triggers: WorkflowTrigger[] = includeTimed
        ? [directTrigger, 'before_start', 'after_end']
        : [directTrigger]
      const scope = event.organizationId
        ? eq(automationWorkflows.organizationId, event.organizationId)
        : eq(automationWorkflows.userId, event.userId!)
      const workflows = await tx.select().from(automationWorkflows).where(and(
        scope,
        eq(automationWorkflows.active, true),
        inArray(automationWorkflows.trigger, triggers),
        or(isNull(automationWorkflows.eventTypeId), eq(automationWorkflows.eventTypeId, event.eventTypeId!)),
        lte(automationWorkflows.createdAt, event.occurredAt)
      ))

      if (workflows.length) {
        await tx.insert(automationRuns).values(workflows.map(workflow => ({
          workflowId: workflow.id,
          domainEventId: event.id,
          bookingId: booking.id,
          availableAt: workflow.trigger === 'before_start'
            ? subtractFromInstant(booking.startsAt, { minutes: workflow.offsetMinutes })
            : workflow.trigger === 'after_end'
              ? addToInstant(booking.endsAt, { minutes: workflow.offsetMinutes })
              : event.occurredAt
        }))).onConflictDoNothing()
      }
      await tx.update(domainEvents).set({ dispatchedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(domainEvents.id, event.id))
    }
    return events.length
  })
}

interface DeliveryContext {
  uid: string
  status: string
  startsAt: Date
  endsAt: Date
  attendeeName: string
  attendeeEmail: string
  attendeeTimeZone: string
  meetingUrl: string | null
  eventTitle: string
  hostName: string
  hostEmail: string
  organizationName: string | null
  hostEmails: string[]
}

async function deliveryContext(bookingId: string): Promise<DeliveryContext | null> {
  const db = useDatabase()
  const [row] = await db.select({
    uid: bookings.uid,
    status: bookings.status,
    startsAt: bookings.startsAt,
    endsAt: bookings.endsAt,
    attendeeName: bookings.attendeeName,
    attendeeEmail: bookings.attendeeEmail,
    attendeeTimeZone: bookings.attendeeTimeZone,
    meetingUrl: bookings.meetingUrl,
    eventTitle: eventTypes.title,
    hostName: users.name,
    hostEmail: users.email,
    organizationName: organizations.name
  }).from(bookings)
    .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
    .innerJoin(users, eq(users.id, bookings.hostId))
    .leftJoin(organizations, eq(organizations.id, bookings.organizationId))
    .where(eq(bookings.id, bookingId)).limit(1)
  if (!row) return null
  const hosts = await db.select({ email: users.email }).from(bookingHosts)
    .innerJoin(users, eq(users.id, bookingHosts.userId))
    .where(and(eq(bookingHosts.bookingId, bookingId), isNull(bookingHosts.releasedAt)))
  return { ...row, hostEmails: hosts.length ? hosts.map(host => host.email) : [row.hostEmail] }
}

function formatInTimeZone(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full', timeStyle: 'short', timeZone
  }).format(value)
}

function renderTemplate(value: string, booking: DeliveryContext) {
  const bookingUrl = `${useEnv().schedraUrl}/booking/${booking.uid}`
  const variables: Record<string, string> = {
    guest_name: booking.attendeeName,
    guest_email: booking.attendeeEmail,
    host_name: booking.hostName,
    event_name: booking.eventTitle,
    start_time: formatInTimeZone(booking.startsAt, booking.attendeeTimeZone),
    end_time: formatInTimeZone(booking.endsAt, booking.attendeeTimeZone),
    booking_url: bookingUrl,
    meeting_url: booking.meetingUrl ?? bookingUrl,
    team_name: booking.organizationName ?? ''
  }
  return value.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key: string) => variables[key] ?? '')
}

async function deliverEmail(runId: string, action: Extract<WorkflowAction, { type: 'email' }>, booking: DeliveryContext) {
  const recipients = action.recipient === 'attendee'
    ? [booking.attendeeEmail]
    : action.recipient === 'hosts'
      ? booking.hostEmails
      : [action.customRecipient!]
  const actionUrl = `${useEnv().schedraUrl}/booking/${booking.uid}`
  await enqueueEmails(recipients.map(recipient => ({
    dedupeKey: emailDedupeKey(`automation:${runId}`, recipient),
    category: 'automation',
    bookingUid: booking.uid,
    email: {
      to: recipient,
      subject: renderTemplate(action.subject, booking),
      preheader: renderTemplate(action.subject, booking),
      heading: renderTemplate(action.subject, booking),
      body: renderTemplate(action.body, booking),
      action: { label: 'View booking', url: actionUrl },
      footer: 'This message was sent by an automation in Schedra.'
    }
  })))
}

async function deliverWebhook(
  runId: string,
  trigger: string,
  action: Extract<WorkflowAction, { type: 'webhook' }>,
  encryptedSecret: string,
  booking: DeliveryContext
) {
  const url = await validateWebhookDestination(action.url)
  const timestamp = unixSeconds().toString()
  const body = JSON.stringify({
    id: runId,
    type: trigger,
    createdAt: new Date().toISOString(),
    data: {
      booking: {
        uid: booking.uid,
        status: booking.status,
        eventName: booking.eventTitle,
        startsAt: booking.startsAt.toISOString(),
        endsAt: booking.endsAt.toISOString(),
        attendee: { name: booking.attendeeName, email: booking.attendeeEmail },
        host: { name: booking.hostName },
        teamName: booking.organizationName,
        meetingUrl: booking.meetingUrl
      }
    }
  })
  const signature = createHmac('sha256', decryptCredential(encryptedSecret))
    .update(`${timestamp}.${body}`).digest('hex')
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    // Following redirects would allow a public URL to bounce delivery into a
    // private network after it has passed destination validation.
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Schedra-Webhooks/1.0',
      'x-schedra-event': trigger,
      'x-schedra-delivery': runId,
      'x-schedra-timestamp': timestamp,
      'x-schedra-signature': `v1=${signature}`
    },
    body
  })
  if (!response.ok) throw new Error(`Webhook endpoint returned ${response.status}.`)
}

export async function processAutomationRuns(batchSize = 20) {
  const db = useDatabase()
  const runs = await db.transaction(async (tx) => {
    await tx.update(automationRuns).set({
      status: 'pending', lockedAt: null, availableAt: sql`now()`, updatedAt: sql`now()`
    }).where(and(eq(automationRuns.status, 'processing'), lt(automationRuns.lockedAt, sql`now() - interval '10 minutes'`)))
    const pending = await tx.select().from(automationRuns)
      .where(and(eq(automationRuns.status, 'pending'), lte(automationRuns.availableAt, sql`now()`)))
      .orderBy(asc(automationRuns.availableAt)).limit(batchSize).for('update', { skipLocked: true })
    if (!pending.length) return []
    return tx.update(automationRuns).set({
      status: 'processing', lockedAt: sql`now()`, attempts: sql`${automationRuns.attempts} + 1`, updatedAt: sql`now()`
    }).where(inArray(automationRuns.id, pending.map(run => run.id))).returning()
  })

  for (const run of runs) {
    try {
      const [workflow, booking] = await Promise.all([
        db.select().from(automationWorkflows).where(eq(automationWorkflows.id, run.workflowId)).limit(1).then(rows => rows[0]),
        deliveryContext(run.bookingId)
      ])
      if (!workflow || !workflow.active || !booking) {
        await db.update(automationRuns).set({ status: 'cancelled', lockedAt: null, updatedAt: sql`now()` })
          .where(eq(automationRuns.id, run.id))
        continue
      }
      if (['before_start', 'after_end'].includes(workflow.trigger) && booking.status !== 'confirmed') {
        await db.update(automationRuns).set({ status: 'cancelled', lockedAt: null, updatedAt: sql`now()` })
          .where(eq(automationRuns.id, run.id))
        continue
      }
      if (workflow.action.type === 'email') await deliverEmail(run.id, workflow.action, booking)
      else {
        if (!workflow.webhookSecretEncrypted) throw new Error('Webhook signing secret is missing.')
        await deliverWebhook(run.id, workflow.trigger, workflow.action, workflow.webhookSecretEncrypted, booking)
      }
      await db.update(automationRuns).set({
        status: 'completed', completedAt: sql`now()`, lockedAt: null, lastError: null, updatedAt: sql`now()`
      }).where(eq(automationRuns.id, run.id))
    } catch (error) {
      const failed = run.attempts >= 8
      const delaySeconds = Math.min(3600, 15 * 2 ** Math.max(0, run.attempts - 1))
      await db.update(automationRuns).set({
        status: failed ? 'failed' : 'pending',
        availableAt: addToInstant(Date.now(), { seconds: delaySeconds }),
        lockedAt: null,
        lastError: String(error instanceof Error ? error.message : error).slice(0, 1000),
        updatedAt: sql`now()`
      }).where(eq(automationRuns.id, run.id))
      logEvent('error', 'automation_delivery_failed', { runId: run.id, attempt: run.attempts, terminal: failed, error })
    }
  }
  return runs.length
}
