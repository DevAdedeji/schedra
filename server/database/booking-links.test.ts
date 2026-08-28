import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { configureAppTestEnvironment, getTestDatabaseUrl } from '../../test/helpers/database'

const url = getTestDatabaseUrl()

describe.skipIf(!url)('private booking links', () => {
  const sql = postgres(url!, { max: 5, onnotice: () => {} })
  let userId: string
  let eventTypeId: string

  beforeEach(async () => {
    configureAppTestEnvironment(url!)
    const { resetEnv } = await import('../config/env')
    resetEnv()

    await sql`truncate table booking_link_slots, booking_links, bookings, event_types, schedules, users, organizations restart identity cascade`

    const [user] = await sql<{ id: string }[]>`
      insert into users (email, name, username, email_verified, time_zone)
      values ('private-host@example.com', 'Private Host', 'private-host', true, 'Africa/Lagos')
      returning id
    `
    userId = user!.id

    const [eventType] = await sql<{ id: string }[]>`
      insert into event_types (user_id, slug, title, duration_minutes, hidden)
      values (${userId}, 'private-intro', 'Private intro', 30, true)
      returning id
    `
    eventTypeId = eventType!.id
  })

  afterAll(async () => {
    await sql`truncate table booking_link_slots, booking_links, bookings, event_types, schedules, users, organizations restart identity cascade`
    await sql.end()
  })

  it('stores only a token hash and resolves hidden event types through the capability', async () => {
    const { createBookingLink, resolveBookingLink, bookingLinkTokenHash } = await import('../services/booking-links')
    const created = await createBookingLink(userId, {
      kind: 'single_use',
      eventTypeId,
      label: 'Investor follow-up',
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      slots: []
    })

    expect(created.token).toMatch(/^[A-Za-z0-9_-]{32,128}$/)
    expect(created.path).toBe(`/meeting/${created.token}`)

    const [stored] = await sql<{ token_hash: string }[]>`
      select token_hash from booking_links where id = ${created.id}
    `
    expect(stored?.token_hash).toBe(bookingLinkTokenHash(created.token))
    expect(stored?.token_hash).not.toContain(created.token)

    const resolved = await resolveBookingLink(created.token)
    expect(resolved).toMatchObject({
      id: eventTypeId,
      username: 'private-host',
      slug: 'private-intro',
      kind: 'single_use'
    })
  })

  it('lets exactly one concurrent request claim a link', async () => {
    const { bookingLinkTokenHash } = await import('../services/booking-links')
    const { claimBookingLink, createBookingLinkRecord } = await import('../repositories/booking-links')
    const { useDatabase } = await import('../database')
    const tokenHash = bookingLinkTokenHash('race-safe-private-token-that-is-long-enough')

    await createBookingLinkRecord({
      userId,
      eventTypeId,
      tokenHash,
      kind: 'single_use',
      label: null,
      expiresAt: new Date(Date.now() + 86_400_000),
      slots: []
    })

    const results = await Promise.all([
      claimBookingLink(tokenHash, eventTypeId, useDatabase()),
      claimBookingLink(tokenHash, eventTypeId, useDatabase())
    ])
    expect(results.sort()).toEqual([false, true])

    const [stored] = await sql<{ used: boolean }[]>`
      select used_at is not null as used from booking_links where token_hash = ${tokenHash}
    `
    expect(stored?.used).toBe(true)
  })

  it('keeps one-off choices unique and rejects invalid time ranges', async () => {
    const { createBookingLinkRecord } = await import('../repositories/booking-links')
    const start = new Date(Date.now() + 86_400_000)
    const end = new Date(start.getTime() + 30 * 60_000)

    const created = await createBookingLinkRecord({
      userId,
      eventTypeId,
      tokenHash: 'one-off-valid-hash',
      kind: 'one_off',
      label: null,
      expiresAt: new Date(end.getTime() + 60_000),
      slots: [{ start, end }]
    })

    await expect(sql`
      insert into booking_link_slots (booking_link_id, starts_at, ends_at)
      values (${created.id}, ${start}, ${end})
    `).rejects.toMatchObject({ code: '23505' })

    await expect(sql`
      insert into booking_link_slots (booking_link_id, starts_at, ends_at)
      values (${created.id}, ${new Date(start.getTime() + 60_000)}, ${start})
    `).rejects.toMatchObject({ code: '23514' })
  })

  it('lists empty meeting-link counts without serializing raw JavaScript dates', async () => {
    const { listBookingLinkRecords } = await import('../repositories/booking-links')

    await expect(listBookingLinkRecords({
      userId,
      filter: 'all',
      page: 1,
      pageSize: 10
    })).resolves.toMatchObject({
      total: 0,
      counts: { all: 0, available: 0, booked: 0, closed: 0 },
      items: []
    })
  })
})
