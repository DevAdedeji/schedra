import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestDatabaseUrl } from '../../test/helpers/database'

const url = getTestDatabaseUrl()

describe.skipIf(!url)('group event database invariants', () => {
  const sql = postgres(url!, { max: 5, onnotice: () => {} })

  let hostId: string
  let eventTypeId: string
  let sessionId: string

  afterAll(async () => {
    await sql`truncate table group_event_sessions, bookings, event_types, schedules, users, organizations restart identity cascade`
    await sql.end()
  })

  beforeEach(async () => {
    await sql`truncate table group_event_sessions, bookings, event_types, schedules, users, organizations restart identity cascade`

    const [host] = await sql<{ id: string }[]>`
      insert into users (email, name, username)
      values ('group-host@example.com', 'Group Host', 'group-host') returning id
    `
    hostId = host!.id

    const [eventType] = await sql<{ id: string }[]>`
      insert into event_types (user_id, slug, title, duration_minutes, capacity)
      values (${hostId}, 'group-intro', 'Group intro', 30, 2) returning id
    `
    eventTypeId = eventType!.id

    const [session] = await sql<{ id: string }[]>`
      insert into group_event_sessions (event_type_id, starts_at, ends_at, capacity)
      values (${eventTypeId}, '2026-09-07T09:00:00Z', '2026-09-07T09:30:00Z', 2)
      returning id
    `
    sessionId = session!.id
  })

  function seat(email: string, status: 'awaiting_payment' | 'confirmed' = 'confirmed') {
    return sql`
      insert into bookings (
        event_type_id, group_session_id, host_id, uid, status,
        starts_at, ends_at, attendee_name, attendee_email, attendee_time_zone
      ) values (
        ${eventTypeId}, ${sessionId}, ${hostId}, ${crypto.randomUUID()}, ${status},
        '2026-09-07T09:00:00Z', '2026-09-07T09:30:00Z',
        'Guest', ${email}, 'Africa/Lagos'
      ) returning id
    `
  }

  it('allows seats in the same occurrence to overlap without duplicating the host commitment', async () => {
    await seat('one@example.com')
    await seat('two@example.com')

    const [counts] = await sql<{ seats: number, reservations: number }[]>`
      select
        (select count(*)::int from bookings where group_session_id = ${sessionId}) as seats,
        (select count(distinct group_session_id)::int from booking_hosts where group_session_id = ${sessionId}) as reservations
    `

    expect(counts).toEqual({ seats: 2, reservations: 1 })
  })

  it('rejects a seat beyond the immutable session capacity', async () => {
    await seat('one@example.com')
    await seat('two@example.com')

    await expect(seat('three@example.com')).rejects.toMatchObject({ code: '23514' })
  })

  it('counts additional guests against the session capacity', async () => {
    await sql`
      insert into bookings (
        event_type_id, group_session_id, host_id, uid, status,
        starts_at, ends_at, attendee_name, attendee_email,
        attendee_time_zone, additional_guest_emails
      ) values (
        ${eventTypeId}, ${sessionId}, ${hostId}, ${crypto.randomUUID()}, 'confirmed',
        '2026-09-07T09:00:00Z', '2026-09-07T09:30:00Z',
        'Guest', 'party@example.com', 'Africa/Lagos', '["friend@example.com"]'::jsonb
      )
    `

    await expect(seat('another@example.com')).rejects.toMatchObject({ code: '23514' })
  })

  it('releases capacity when a guest cancels', async () => {
    const [first] = await seat('one@example.com')
    await seat('two@example.com')
    await sql`update bookings set status = 'cancelled' where id = ${first!.id}`

    await expect(seat('three@example.com')).resolves.toHaveLength(1)
  })

  it('reserves group capacity and host time while checkout is open', async () => {
    const [hold] = await seat('paying@example.com', 'awaiting_payment')
    await seat('second@example.com')
    await expect(seat('full@example.com')).rejects.toMatchObject({ code: '23514' })

    await sql`update bookings set status = 'cancelled' where id = ${hold!.id}`
    await expect(seat('replacement@example.com')).resolves.toHaveLength(1)
  })

  it('still rejects an unrelated booking that overlaps the group session', async () => {
    await seat('one@example.com')

    await expect(sql`
      insert into bookings (
        event_type_id, host_id, uid, status, starts_at, ends_at,
        attendee_name, attendee_email, attendee_time_zone
      ) values (
        ${eventTypeId}, ${hostId}, ${crypto.randomUUID()}, 'confirmed',
        '2026-09-07T09:15:00Z', '2026-09-07T09:45:00Z',
        'Other Guest', 'other@example.com', 'Africa/Lagos'
      )
    `).rejects.toMatchObject({ code: '23P01' })
  })

  it('rejects a booking whose event or time does not match its session', async () => {
    await expect(sql`
      insert into bookings (
        event_type_id, group_session_id, host_id, uid, status,
        starts_at, ends_at, attendee_name, attendee_email, attendee_time_zone
      ) values (
        ${eventTypeId}, ${sessionId}, ${hostId}, ${crypto.randomUUID()}, 'confirmed',
        '2026-09-07T10:00:00Z', '2026-09-07T10:30:00Z',
        'Guest', 'mismatch@example.com', 'Africa/Lagos'
      )
    `).rejects.toMatchObject({ code: '23514' })
  })
})
