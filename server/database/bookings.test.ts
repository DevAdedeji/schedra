import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestDatabaseUrl } from '../../test/helpers/database'

const url = getTestDatabaseUrl()

describe.skipIf(!url)('bookings_no_overlap_per_host', () => {
  const sql = postgres(url!, { max: 5, onnotice: () => {} })

  let hostId: string
  let otherHostId: string
  let eventTypeId: string

  afterAll(async () => {
    await sql`truncate table email_outbox, api_rate_limits, rate_limits, sessions, accounts, verifications, bookings, event_types, date_overrides, availability_rules, schedules, users, organizations restart identity cascade`
    await sql.end()
  })

  beforeEach(async () => {
    await sql`truncate table bookings, event_types, schedules, users, organizations restart identity cascade`

    const [host] = await sql<{ id: string }[]>`
      insert into users (email, name, username)
      values ('host@example.com', 'Host', 'host') returning id
    `
    const [other] = await sql<{ id: string }[]>`
      insert into users (email, name, username)
      values ('other@example.com', 'Other', 'other') returning id
    `
    hostId = host!.id
    otherHostId = other!.id

    const [eventType] = await sql<{ id: string }[]>`
      insert into event_types (user_id, slug, title, duration_minutes)
      values (${hostId}, 'intro', 'Intro call', 30) returning id
    `
    eventTypeId = eventType!.id
  })

  function book(
    connection: postgres.Sql | postgres.ReservedSql,
    start: string,
    end: string,
    options: { status?: string, host?: () => string } = {}
  ) {
    return connection`
      insert into bookings (
        event_type_id, host_id, uid, status, starts_at, ends_at,
        attendee_name, attendee_email, attendee_time_zone
      ) values (
        ${eventTypeId},
        ${options.host ? options.host() : hostId},
        ${crypto.randomUUID()},
        ${options.status ?? 'confirmed'},
        ${start},
        ${end},
        'Attendee',
        'attendee@example.com',
        'Africa/Lagos'
      ) returning id
    `
  }

  it('rejects a second booking overlapping the same host', async () => {
    await book(sql, '2026-08-17T09:00:00Z', '2026-08-17T09:30:00Z')

    await expect(
      book(sql, '2026-08-17T09:15:00Z', '2026-08-17T09:45:00Z')
    ).rejects.toMatchObject({ code: '23P01' })
  })

  it('allows back-to-back bookings', async () => {
    await book(sql, '2026-08-17T09:00:00Z', '2026-08-17T09:30:00Z')

    await expect(
      book(sql, '2026-08-17T09:30:00Z', '2026-08-17T10:00:00Z')
    ).resolves.toHaveLength(1)
  })

  it('frees the slot once a booking is cancelled', async () => {
    const [booking] = await book(sql, '2026-08-17T09:00:00Z', '2026-08-17T09:30:00Z')
    await sql`update bookings set status = 'cancelled' where id = ${booking!.id}`

    await expect(
      book(sql, '2026-08-17T09:00:00Z', '2026-08-17T09:30:00Z')
    ).resolves.toHaveLength(1)
  })

  it('constrains each host separately', async () => {
    await book(sql, '2026-08-17T09:00:00Z', '2026-08-17T09:30:00Z')

    await expect(
      book(sql, '2026-08-17T09:00:00Z', '2026-08-17T09:30:00Z', { host: () => otherHostId })
    ).resolves.toHaveLength(1)
  })

  it('rejects the loser of a genuine concurrent race', async () => {
    const first = await sql.reserve()
    const second = await sql.reserve()

    try {
      await first`begin`
      await second`begin`

      await book(first, '2026-08-17T14:00:00Z', '2026-08-17T14:30:00Z')

      const contender = book(second, '2026-08-17T14:00:00Z', '2026-08-17T14:30:00Z')
        .catch((error: unknown) => error)
      await new Promise(resolve => setTimeout(resolve, 50))

      await first`commit`

      expect(await contender).toMatchObject({ code: '23P01' })
      await second`rollback`
    } finally {
      first.release()
      second.release()
    }

    const rows = await sql`select count(*)::int as count from bookings`
    expect(rows[0]!.count).toBe(1)
  })
})
