import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureAppTestEnvironment, getTestDatabaseUrl } from '../../test/helpers/database'

const url = getTestDatabaseUrl()

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
    configureAppTestEnvironment(url!)
    const { resetEnv } = await import('../config/env')
    resetEnv()
    const { useAuth } = await import('../services/auth')
    return useAuth()
  }

  async function signUp() {
    await (await auth()).api.signUpEmail({ body: credentials })
    await sql`update users set email_verified = true where email = ${credentials.email}`
  }

  afterAll(async () => {
    vi.unstubAllGlobals()
    await sql`truncate table email_outbox, api_rate_limits, rate_limits, sessions, accounts, verifications, bookings, event_types, date_overrides, availability_rules, schedules, users, organizations restart identity cascade`
    await sql.end()
  })

  beforeEach(async () => {
    vi.stubGlobal('createError', (input: { statusCode: number, statusMessage: string }) => Object.assign(
      new Error(input.statusMessage),
      input
    ))
    await sql`truncate table email_outbox, api_rate_limits, rate_limits, sessions, accounts, verifications, bookings, event_types, date_overrides, availability_rules, schedules, users, organizations restart identity cascade`
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

  it('keeps an unverified account off public booking pages', async () => {
    await (await auth()).api.signUpEmail({ body: credentials })
    const { findPublicEventType } = await import('../services/booking-page')

    expect(await findPublicEventType('ada', '30min')).toBeNull()
  })

  it('resolves the booking page and offers real slots', async () => {
    await signUp()

    const { findPublicEventType, slotsFor } = await import('../services/booking-page')
    const event = await findPublicEventType('ada', '30min')
    expect(event).not.toBeNull()

    // A Monday well clear of the notice window.
    const slots = await slotsFor(event!, '2026-09-07', '2026-09-07', '2026-09-01T00:00:00Z')

    // 09:00–17:00 Lagos in 30 minute steps.
    expect(slots).toHaveLength(16)
    expect(slots[0]!.start).toBe('2026-09-07T08:00:00Z')
    expect(slots.at(-1)!.start).toBe('2026-09-07T15:30:00Z')
  })

  it('offers and validates each configured duration independently', async () => {
    await signUp()
    await sql`update event_types set additional_duration_minutes = array[60] where slug = '30min'`

    const { findPublicEventType, slotsFor } = await import('../services/booking-page')
    const event = (await findPublicEventType('ada', '30min'))!
    const slots = await slotsFor(event, '2026-09-07', '2026-09-07', '2026-09-01T00:00:00Z', 60)

    expect(slots).toHaveLength(15)
    expect(Date.parse(slots[0]!.end) - Date.parse(slots[0]!.start)).toBe(60 * 60_000)
    expect(slots.at(-1)!.start).toBe('2026-09-07T15:00:00Z')
    await expect(
      slotsFor(event, '2026-09-07', '2026-09-07', '2026-09-01T00:00:00Z', 45)
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('is case-insensitive on the username and slug', async () => {
    await signUp()
    const { findPublicEventType } = await import('../services/booking-page')

    expect(await findPublicEventType('ADA', '30MIN')).not.toBeNull()
    expect(await findPublicEventType('nobody', '30min')).toBeNull()
  })

  it('does not offer a slot that collides with an existing booking', async () => {
    await signUp()
    const { findPublicEventType, slotsFor } = await import('../services/booking-page')
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
    const { findPublicEventType, slotsFor } = await import('../services/booking-page')
    const event = (await findPublicEventType('ada', '30min'))!

    const slots = await slotsFor(event!, '2026-09-05', '2026-09-05', '2026-09-01T00:00:00Z')
    expect(slots).toEqual([])
  })

  it('refuses a time outside the host\'s hours', async () => {
    await signUp()
    const { findPublicEventType, slotsFor } = await import('../services/booking-page')
    const event = (await findPublicEventType('ada', '30min'))!

    // 03:00 in Lagos, hours before the schedule opens.
    const offered = await slotsFor(event, '2026-09-07', '2026-09-07', '2026-09-01T00:00:00Z')
    const wanted = new Date('2026-09-07T02:00:00Z').getTime()

    expect(offered.some(slot => new Date(slot.start).getTime() === wanted)).toBe(false)
  })

  it('withholds a slot once it is booked', async () => {
    await signUp()
    const { findPublicEventType, slotsFor } = await import('../services/booking-page')
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
    const { findPublicEventType, slotsFor } = await import('../services/booking-page')
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

  it('applies weekly limits to this event type and resets them on Monday', async () => {
    await signUp()
    const { findPublicEventType, slotsFor } = await import('../services/booking-page')
    const event = (await findPublicEventType('ada', '30min'))!
    await sql`update event_types set max_per_week = 1 where id = ${event.id}`

    const [other] = await sql<{ id: string }[]>`
      insert into event_types (user_id, slug, title, duration_minutes)
      values (${event.hostId}, 'other', 'Other event', 30) returning id
    `
    await sql`
      insert into bookings (event_type_id, host_id, uid, starts_at, ends_at,
                            attendee_name, attendee_email, attendee_time_zone)
      values (${other!.id}, ${event.hostId}, 'other-event-booking',
              '2026-09-07T08:00:00Z', '2026-09-07T08:30:00Z',
              'Guest', 'guest@example.com', 'Africa/Lagos')
    `

    const refreshed = (await findPublicEventType('ada', '30min'))!
    expect(await slotsFor(refreshed, '2026-09-11', '2026-09-11', '2026-09-01T00:00:00Z'))
      .not.toHaveLength(0)

    await sql`
      insert into bookings (event_type_id, host_id, uid, starts_at, ends_at,
                            attendee_name, attendee_email, attendee_time_zone)
      values (${event.id}, ${event.hostId}, 'limited-event-booking',
              '2026-09-08T08:00:00Z', '2026-09-08T08:30:00Z',
              'Guest', 'guest@example.com', 'Africa/Lagos')
    `

    expect(await slotsFor(refreshed, '2026-09-11', '2026-09-11', '2026-09-01T00:00:00Z'))
      .toEqual([])
    expect(await slotsFor(refreshed, '2026-09-14', '2026-09-14', '2026-09-01T00:00:00Z'))
      .not.toHaveLength(0)
  })

  it('keeps an open group occurrence available while blocking new sessions at the daily cap', async () => {
    await signUp()
    const { findPublicEventType, slotsFor } = await import('../services/booking-page')
    const event = (await findPublicEventType('ada', '30min'))!
    await sql`update event_types set capacity = 3, max_per_day = 1 where id = ${event.id}`
    const [session] = await sql<{ id: string }[]>`
      insert into group_event_sessions (event_type_id, starts_at, ends_at, capacity)
      values (${event.id}, '2026-09-07T08:00:00Z', '2026-09-07T08:30:00Z', 3)
      returning id
    `
    await sql`
      insert into bookings (event_type_id, group_session_id, host_id, uid, starts_at, ends_at,
                            attendee_name, attendee_email, attendee_time_zone)
      values (${event.id}, ${session!.id}, ${event.hostId}, 'first-group-seat',
              '2026-09-07T08:00:00Z', '2026-09-07T08:30:00Z',
              'Guest', 'guest@example.com', 'Africa/Lagos')
    `

    const refreshed = (await findPublicEventType('ada', '30min'))!
    const slots = await slotsFor(refreshed, '2026-09-07', '2026-09-07', '2026-09-01T00:00:00Z')
    expect(slots).toEqual([{
      start: '2026-09-07T08:00:00Z',
      end: '2026-09-07T08:30:00Z',
      availableSeats: 2
    }])
  })

  it('finds a booking by its opaque uid, and nothing by a wrong one', async () => {
    await signUp()
    const { findPublicEventType } = await import('../services/booking-page')
    const { findBookingByUid } = await import('../repositories/booking')
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
    expect(found?.durationMinutes).toBe(30)

    await sql`update event_types set duration_minutes = 60 where id = ${event.id}`
    expect((await findBookingByUid('known-uid'))?.durationMinutes).toBe(30)

    expect(await findBookingByUid('not-a-real-uid')).toBeNull()
  })
})
