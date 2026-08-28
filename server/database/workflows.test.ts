import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { configureAppTestEnvironment, getTestDatabaseUrl } from '../../test/helpers/database'

const url = getTestDatabaseUrl()

describe.skipIf(!url)('workflow automation durability', () => {
  const sql = postgres(url!, { max: 3, onnotice: () => {} })
  let userId: string
  let eventTypeId: string
  let bookingId: string

  beforeEach(async () => {
    configureAppTestEnvironment(url!)
    const { resetEnv } = await import('../config/env')
    resetEnv()
    await sql`truncate table automation_runs, domain_events, automation_workflows, email_outbox, booking_hosts, bookings, event_types, schedules, users, organizations restart identity cascade`

    const [user] = await sql<{ id: string }[]>`
      insert into users (email, name, username)
      values ('host@example.com', 'Ada Host', 'ada-host') returning id
    `
    userId = user!.id
    const [eventType] = await sql<{ id: string }[]>`
      insert into event_types (user_id, slug, title, duration_minutes)
      values (${userId}, 'intro', 'Intro call', 30) returning id
    `
    eventTypeId = eventType!.id
    const [booking] = await sql<{ id: string }[]>`
      insert into bookings (
        event_type_id, host_id, uid, status, starts_at, ends_at,
        attendee_name, attendee_email, attendee_time_zone
      ) values (
        ${eventTypeId}, ${userId}, 'workflow-booking', 'confirmed',
        now() + interval '2 days', now() + interval '2 days 30 minutes',
        'Grace Guest', 'guest@example.com', 'Africa/Lagos'
      ) returning id
    `
    bookingId = booking!.id
  })

  afterAll(async () => {
    await sql`truncate table automation_runs, domain_events, automation_workflows, email_outbox, booking_hosts, bookings, event_types, schedules, users, organizations restart identity cascade`
    await sql.end()
  })

  it('dispatches one idempotent run and queues its email once', async () => {
    const { createWorkflow, dispatchDomainEvents, processAutomationRuns, publishBookingEvent } = await import('../services/workflows')
    await createWorkflow({ userId }, userId, {
      name: 'Welcome guest',
      trigger: 'booking_created',
      offsetMinutes: 0,
      eventTypeId: null,
      active: true,
      action: {
        type: 'email',
        recipient: 'attendee',
        subject: 'You are booked for {{event_name}}',
        body: 'Hello {{guest_name}}, your meeting starts at {{start_time}}.'
      }
    })

    await publishBookingEvent({ type: 'booking_created', userId, bookingId, eventTypeId })
    await publishBookingEvent({ type: 'booking_created', userId, bookingId, eventTypeId })
    await expect(dispatchDomainEvents()).resolves.toBe(1)
    await expect(dispatchDomainEvents()).resolves.toBe(0)
    await expect(processAutomationRuns()).resolves.toBe(1)
    await expect(processAutomationRuns()).resolves.toBe(0)

    const [state] = await sql<{ events: number, runs: number, emails: number, status: string }[]>`
      select
        (select count(*)::int from domain_events) as events,
        (select count(*)::int from automation_runs) as runs,
        (select count(*)::int from email_outbox) as emails,
        (select status::text from automation_runs limit 1) as status
    `
    expect(state).toMatchObject({ events: 1, runs: 1, emails: 1, status: 'completed' })
    const [email] = await sql<{ recipient: string, subject: string, body: string, category: string }[]>`
      select recipient, subject, body, category from email_outbox limit 1
    `
    expect(email).toMatchObject({
      recipient: 'guest@example.com',
      subject: 'You are booked for Intro call',
      category: 'automation'
    })
    expect(email!.body).toContain('Hello Grace Guest')
  })

  it('backfills a timed workflow and cancels it when the booking is cancelled', async () => {
    const { cancelPendingAutomationRuns, createWorkflow } = await import('../services/workflows')
    await createWorkflow({ userId }, userId, {
      name: 'One day reminder',
      trigger: 'before_start',
      offsetMinutes: 1440,
      eventTypeId,
      active: true,
      action: {
        type: 'email',
        recipient: 'attendee',
        subject: 'Meeting tomorrow',
        body: 'Your {{event_name}} meeting is tomorrow.'
      }
    })

    const [scheduled] = await sql<{ status: string, available_at: Date }[]>`
      select status::text, available_at from automation_runs where booking_id = ${bookingId}
    `
    expect(scheduled?.status).toBe('pending')
    expect(scheduled?.available_at).toBeInstanceOf(Date)

    await cancelPendingAutomationRuns(bookingId)
    const [cancelled] = await sql<{ status: string }[]>`
      select status::text from automation_runs where booking_id = ${bookingId}
    `
    expect(cancelled?.status).toBe('cancelled')
  })

  it('prevents a workflow from targeting another account event type', async () => {
    const [other] = await sql<{ id: string }[]>`
      insert into users (email, name, username)
      values ('other@example.com', 'Other Host', 'other-host') returning id
    `
    const [otherEvent] = await sql<{ id: string }[]>`
      insert into event_types (user_id, slug, title, duration_minutes)
      values (${other!.id}, 'private', 'Private call', 30) returning id
    `
    const { createWorkflow } = await import('../services/workflows')
    await expect(createWorkflow({ userId }, userId, {
      name: 'Cross-account workflow',
      trigger: 'booking_created',
      offsetMinutes: 0,
      eventTypeId: otherEvent!.id,
      active: true,
      action: { type: 'email', recipient: 'attendee', subject: 'Hi', body: 'Hello' }
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('makes terminal failures manually retryable in operations', async () => {
    const [workflow] = await sql<{ id: string }[]>`
      insert into automation_workflows (
        user_id, created_by_user_id, name, trigger, action
      ) values (
        ${userId}, ${userId}, 'Failed workflow', 'booking_created',
        ${sql.json({ type: 'email', recipient: 'attendee', subject: 'Hi', body: 'Hello' })}
      ) returning id
    `
    const [run] = await sql<{ id: string }[]>`
      insert into automation_runs (workflow_id, booking_id, status, attempts, last_error)
      values (${workflow!.id}, ${bookingId}, 'failed', 8, 'Provider unavailable') returning id
    `
    const { retryOperation } = await import('../services/operations')
    await expect(retryOperation('automation', run!.id)).resolves.toBe(true)
    const [retried] = await sql<{ status: string, attempts: number, last_error: string | null }[]>`
      select status::text, attempts, last_error from automation_runs where id = ${run!.id}
    `
    expect(retried).toMatchObject({ status: 'pending', attempts: 0, last_error: null })
  })
})
