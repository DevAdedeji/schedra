import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { configureAppTestEnvironment, getTestDatabaseUrl } from '../../test/helpers/database'

const url = getTestDatabaseUrl()

describe.skipIf(!url)('Integration health and durable retry', () => {
  const sql = postgres(url!, { max: 5, onnotice: () => {} })

  async function createBooking() {
    const [host] = await sql<{ id: string }[]>`
      insert into users (email, name, username, email_verified, time_zone)
      values ('health-host@example.com', 'Health Host', 'health-host', true, 'UTC')
      returning id
    `
    const [schedule] = await sql<{ id: string }[]>`
      insert into schedules (user_id, name, time_zone, is_default)
      values (${host!.id}, 'Working hours', 'UTC', true)
      returning id
    `
    const [eventType] = await sql<{ id: string }[]>`
      insert into event_types (user_id, schedule_id, slug, title, duration_minutes)
      values (${host!.id}, ${schedule!.id}, 'health', 'Health check', 30)
      returning id
    `
    const [booking] = await sql<{ id: string }[]>`
      insert into bookings (
        event_type_id, host_id, uid, starts_at, ends_at,
        attendee_name, attendee_email, attendee_time_zone
      ) values (
        ${eventType!.id}, ${host!.id}, 'health-booking',
        now() + interval '1 day', now() + interval '1 day 30 minutes',
        'Guest', 'guest@example.com', 'UTC'
      ) returning id
    `
    await sql`
      insert into booking_hosts (booking_id, user_id, is_organizer, starts_at, ends_at)
      select id, host_id, true, starts_at, ends_at from bookings where id = ${booking!.id}
      on conflict do nothing
    `
    return { hostId: host!.id, bookingId: booking!.id }
  }

  beforeEach(async () => {
    configureAppTestEnvironment(url!)
    await sql`
      truncate table
        calendar_sync_jobs, booking_calendar_events, calendar_connections,
        email_outbox, api_rate_limits, rate_limits, sessions, accounts,
        verifications, bookings, event_types, date_overrides,
        availability_rules, schedules, users, organizations
      restart identity cascade
    `
  })

  afterAll(async () => {
    await sql`
      truncate table
        calendar_sync_jobs, booking_calendar_events, calendar_connections,
        email_outbox, api_rate_limits, rate_limits, sessions, accounts,
        verifications, bookings, event_types, date_overrides,
        availability_rules, schedules, users, organizations
      restart identity cascade
    `
    await sql.end()
  })

  it('keeps one revisioned job per booking and preserves the newest action', async () => {
    const { bookingId } = await createBooking()
    const { enqueueCalendarSync } = await import('../services/calendar-sync')
    await enqueueCalendarSync(bookingId, 'upsert')
    await enqueueCalendarSync(bookingId, 'delete')

    const jobs = await sql<{ action: string, dedupe_key: string, revision: number, status: string }[]>`
      select action, dedupe_key, revision, status from calendar_sync_jobs where booking_id = ${bookingId}
    `
    expect(jobs).toEqual([{
      action: 'delete',
      dedupe_key: `booking:${bookingId}`,
      revision: 2,
      status: 'pending'
    }])
  })

  it('reports provider failures and lets only the affected user retry them', async () => {
    const { hostId, bookingId } = await createBooking()
    const { enqueueCalendarSync } = await import('../services/calendar-sync')
    await enqueueCalendarSync(bookingId, 'upsert')
    await sql`
      update calendar_sync_jobs
      set status = 'failed', attempts = 8,
          failure_provider = 'microsoft', last_error = 'Microsoft Calendar request failed (503).'
      where booking_id = ${bookingId}
    `

    const { integrationSyncHealth, retryFailedIntegrationSyncs } = await import('../services/integration-health')
    await expect(integrationSyncHealth(hostId)).resolves.toMatchObject({
      pending: 0,
      processing: 0,
      failed: 1,
      failureProvider: 'microsoft',
      retryableProviderCounts: { microsoft: 1 }
    })
    await expect(retryFailedIntegrationSyncs(hostId, 'google')).resolves.toBe(0)
    await expect(retryFailedIntegrationSyncs(hostId, 'microsoft')).resolves.toBe(1)

    const [job] = await sql<{ status: string, attempts: number, revision: number, last_error: string | null }[]>`
      select status, attempts, revision, last_error from calendar_sync_jobs where booking_id = ${bookingId}
    `
    expect(job).toMatchObject({ status: 'pending', attempts: 0, revision: 2, last_error: null })
  })
})
