import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const url = process.env.DATABASE_URL

describe.skipIf(!url)('public booking page', () => {
  const sql = postgres(url!, { max: 3, onnotice: () => {} })

  const credentials = {
    name: 'Ada Lovelace',
    username: 'ada',
    email: 'ada@example.com',
    password: 'a-long-enough-passphrase',
    timeZone: 'Africa/Lagos'
  }

  async function auth() {
    process.env.SCHEDRA_URL ||= 'http://localhost:3002'
    process.env.AUTH_SECRET ||= 'x'.repeat(32)
    const { resetEnv } = await import('../utils/env')
    resetEnv()
    const { useAuth } = await import('../utils/auth')
    return useAuth()
  }

  async function signUp() {
    await (await auth()).api.signUpEmail({ body: credentials })
  }

  afterAll(async () => {
    await sql`truncate table sessions, accounts, verifications, bookings, event_types, date_overrides, availability_rules, schedules, users, organizations restart identity cascade`
    await sql.end()
  })

  beforeEach(async () => {
    await sql`truncate table sessions, accounts, verifications, bookings, event_types, date_overrides, availability_rules, schedules, users, organizations restart identity cascade`
  })

  it('gives a new account working hours and something to book', async () => {
    await signUp()

    const [schedule] = await sql<{ id: string, time_zone: string, is_default: boolean }[]>`
      select id, time_zone, is_default from schedules
    `
    expect(schedule?.time_zone).toBe('Africa/Lagos')
    expect(schedule?.is_default).toBe(true)

    const rules = await sql<{ weekday: number }[]>`
      select weekday from availability_rules order by weekday
    `
    expect(rules.map(r => r.weekday)).toEqual([1, 2, 3, 4, 5])

    const [type] = await sql<{ slug: string, duration_minutes: number }[]>`
      select slug, duration_minutes from event_types
    `
    expect(type?.slug).toBe('30min')
    expect(type?.duration_minutes).toBe(30)
  })

  it('resolves the booking page and offers real slots', async () => {
    await signUp()

    const { findPublicEventType, slotsFor } = await import('../utils/booking-page')
    const event = await findPublicEventType('ada', '30min')
    expect(event).not.toBeNull()

    // A Monday well clear of the notice window.
    const slots = await slotsFor(event!, '2026-09-07', '2026-09-07', '2026-09-01T00:00:00Z')

    // 09:00–17:00 Lagos in 30 minute steps.
    expect(slots).toHaveLength(16)
    expect(slots[0]!.start).toBe('2026-09-07T08:00:00Z')
    expect(slots.at(-1)!.start).toBe('2026-09-07T15:30:00Z')
  })

  it('is case-insensitive on the username and slug', async () => {
    await signUp()
    const { findPublicEventType } = await import('../utils/booking-page')

    expect(await findPublicEventType('ADA', '30MIN')).not.toBeNull()
    expect(await findPublicEventType('nobody', '30min')).toBeNull()
  })

  it('does not offer a slot that collides with an existing booking', async () => {
    await signUp()
    const { findPublicEventType, slotsFor } = await import('../utils/booking-page')
    const event = (await findPublicEventType('ada', '30min'))!

    await sql`
      insert into bookings (event_type_id, host_id, uid, starts_at, ends_at,
                            attendee_name, attendee_email, attendee_time_zone)
      values (${event.id}, ${event.hostId}, 'taken-1',
              '2026-09-07T09:00:00Z', '2026-09-07T09:30:00Z',
              'Guest', 'guest@example.com', 'Europe/London')
    `

    const slots = await slotsFor(event!, '2026-09-07', '2026-09-07', '2026-09-01T00:00:00Z')
    expect(slots).toHaveLength(15)
    expect(slots.map(s => s.start)).not.toContain('2026-09-07T09:00:00Z')
  })

  it('skips a weekend, where the default schedule has no hours', async () => {
    await signUp()
    const { findPublicEventType, slotsFor } = await import('../utils/booking-page')
    const event = (await findPublicEventType('ada', '30min'))!

    const slots = await slotsFor(event!, '2026-09-05', '2026-09-05', '2026-09-01T00:00:00Z')
    expect(slots).toEqual([])
  })

  it('refuses a time outside the host\'s hours', async () => {
    await signUp()
    const { findPublicEventType, slotsFor } = await import('../utils/booking-page')
    const event = (await findPublicEventType('ada', '30min'))!

    // 03:00 in Lagos, hours before the schedule opens.
    const offered = await slotsFor(event, '2026-09-07', '2026-09-07', '2026-09-01T00:00:00Z')
    const wanted = new Date('2026-09-07T02:00:00Z').getTime()

    expect(offered.some(slot => new Date(slot.start).getTime() === wanted)).toBe(false)
  })

  it('withholds a slot once it is booked', async () => {
    await signUp()
    const { findPublicEventType, slotsFor } = await import('../utils/booking-page')
    const event = (await findPublicEventType('ada', '30min'))!

    const before = await slotsFor(event, '2026-09-07', '2026-09-07', '2026-09-01T00:00:00Z')

    await sql`
      insert into bookings (event_type_id, host_id, uid, starts_at, ends_at,
                            attendee_name, attendee_email, attendee_time_zone)
      values (${event.id}, ${event.hostId}, ${'uid-' + Date.now()},
              ${before[0]!.start}, ${before[0]!.end},
              'Grace', 'grace@example.com', 'Europe/London')
    `

    const after = await slotsFor(event, '2026-09-07', '2026-09-07', '2026-09-01T00:00:00Z')
    expect(after).toHaveLength(before.length - 1)
    expect(after.map(s => s.start)).not.toContain(before[0]!.start)
  })

  it('offers a slot again once its booking is cancelled', async () => {
    await signUp()
    const { findPublicEventType, slotsFor } = await import('../utils/booking-page')
    const event = (await findPublicEventType('ada', '30min'))!

    const before = await slotsFor(event, '2026-09-07', '2026-09-07', '2026-09-01T00:00:00Z')

    await sql`
      insert into bookings (event_type_id, host_id, uid, starts_at, ends_at,
                            attendee_name, attendee_email, attendee_time_zone)
      values (${event.id}, ${event.hostId}, 'cancel-me',
              ${before[0]!.start}, ${before[0]!.end},
              'Grace', 'grace@example.com', 'Europe/London')
    `
    const taken = await slotsFor(event, '2026-09-07', '2026-09-07', '2026-09-01T00:00:00Z')
    expect(taken).toHaveLength(before.length - 1)

    await sql`update bookings set status = 'cancelled' where uid = 'cancel-me'`

    const freed = await slotsFor(event, '2026-09-07', '2026-09-07', '2026-09-01T00:00:00Z')
    expect(freed).toHaveLength(before.length)
    expect(freed.map(s => s.start)).toContain(before[0]!.start)
  })

  it('finds a booking by its opaque uid, and nothing by a wrong one', async () => {
    await signUp()
    const { findPublicEventType } = await import('../utils/booking-page')
    const { findBookingByUid } = await import('../utils/booking-manage')
    const event = (await findPublicEventType('ada', '30min'))!

    await sql`
      insert into bookings (event_type_id, host_id, uid, starts_at, ends_at,
                            attendee_name, attendee_email, attendee_time_zone)
      values (${event.id}, ${event.hostId}, 'known-uid',
              '2026-09-07T09:00:00Z', '2026-09-07T09:30:00Z',
              'Grace', 'grace@example.com', 'Europe/London')
    `

    const found = await findBookingByUid('known-uid')
    expect(found?.attendeeName).toBe('Grace')
    expect(found?.hostUsername).toBe('ada')
    expect(found?.eventTitle).toBe('30 Minute Meeting')

    expect(await findBookingByUid('not-a-real-uid')).toBeNull()
  })
})
