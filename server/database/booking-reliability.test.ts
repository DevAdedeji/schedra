import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureAppTestEnvironment, getTestDatabaseUrl } from '../../test/helpers/database'

vi.mock('../integrations/calendar/providers', () => ({ calendarBusyTimes: vi.fn(async () => []) }))
const url = getTestDatabaseUrl()

describe.skipIf(!url)('booking reliability', () => {
  const sql = postgres(url!, { max: 5, onnotice: () => {} })
  let hostId: string
  let eventTypeId: string
  beforeEach(async () => {
    configureAppTestEnvironment(url!)
    const { calendarBusyTimes } = await import('../integrations/calendar/providers')
    vi.mocked(calendarBusyTimes).mockReset().mockResolvedValue([])
    vi.stubGlobal('createError', (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input))
    await sql`truncate users, organizations cascade`
    const [host] = await sql`insert into users (email, name, username, email_verified, time_zone)
      values ('reliability@example.com', 'Host', 'reliability', true, 'UTC') returning id`
    hostId = host!.id
    const [schedule] = await sql`insert into schedules (user_id, name, time_zone, is_default)
      values (${hostId}, 'Default', 'UTC', true) returning id`
    await sql`insert into availability_rules (schedule_id, weekday, start_time, end_time)
      select ${schedule!.id}, day, '09:00'::time, '17:00'::time from generate_series(1, 7) day`
    const [event] = await sql`insert into event_types (user_id, schedule_id, slug, title, duration_minutes, minimum_notice_minutes, booking_window_days)
      values (${hostId}, ${schedule!.id}, 'intro', 'Intro', 30, 0, null) returning id`
    eventTypeId = event!.id
  })
  afterAll(async () => {
    await sql`truncate users, organizations cascade`
    await sql.end()
    vi.unstubAllGlobals()
  })

  async function insertBooking(start: string, end: string, otherEventId = eventTypeId) {
    const [row] = await sql`insert into bookings (event_type_id, host_id, uid, starts_at, ends_at, attendee_name, attendee_email, attendee_time_zone)
      values (${otherEventId}, ${hostId}, ${crypto.randomUUID()}, ${start}, ${end}, 'Guest', 'guest@example.com', 'UTC') returning id, uid`
    return row!
  }
  async function event() {
    const { findPublicEventType } = await import('../services/booking-page')
    return (await findPublicEventType('reliability', 'intro'))!
  }
  const request = () => ({ username: 'reliability', slug: 'intro', start: '2030-09-09T12:00:00Z', name: 'Guest', email: 'guest@example.com', timeZone: 'UTC', source: 'hosted' as const })

  it('moves a booking on a full day without consuming another daily/weekly/monthly allowance', async () => {
    await sql`update event_types set max_per_day = 1, max_per_week = 1, max_per_month = 1 where id = ${eventTypeId}`
    const old = await insertBooking('2030-09-09T09:00:00Z', '2030-09-09T09:30:00Z')
    const { createPersonalBooking } = await import('../services/personal-booking-creation')
    const moved = await createPersonalBooking({ ...request(), rescheduleOf: old.uid })
    expect(moved).toMatchObject({ moved: true, start: '2030-09-09T12:00:00Z', status: 'confirmed' })
    const rows = await sql`select status from bookings order by starts_at`
    expect(rows.map(row => row.status)).toEqual(['cancelled', 'confirmed'])
    await expect(createPersonalBooking({ ...request(), rescheduleOf: old.uid })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('validates the management capability before excluding any reservation', async () => {
    const old = await insertBooking('2030-09-09T09:00:00Z', '2030-09-09T09:30:00Z')
    const { bookingToReschedule } = await import('../services/booking-reschedule')
    await expect(bookingToReschedule(old.uid, crypto.randomUUID())).rejects.toMatchObject({ statusCode: 404 })
    await expect(bookingToReschedule(old.uid, eventTypeId, 'other@example.com')).rejects.toMatchObject({ statusCode: 409 })
    expect(await bookingToReschedule(old.uid, eventTypeId, 'GUEST@example.com')).toMatchObject({ id: old.id })
  })

  it('preserves another calendar commitment when moving the local booking', async () => {
    const old = await insertBooking('2030-09-09T09:00:00Z', '2030-09-09T09:30:00Z')
    const { calendarBusyTimes } = await import('../integrations/calendar/providers')
    vi.mocked(calendarBusyTimes).mockResolvedValueOnce([{ start: '2030-09-09T12:00:00Z', end: '2030-09-09T12:30:00Z' }])
    const { createPersonalBooking } = await import('../services/personal-booking-creation')
    await expect(createPersonalBooking({ ...request(), rescheduleOf: old.uid })).rejects.toMatchObject({ statusCode: 409 })
    expect((await sql`select status from bookings where id = ${old.id}`)[0]!.status).toBe('confirmed')
  })

  it('snapshots existing after-buffers across event edits and protects availability and direct writes', async () => {
    await sql`update event_types set buffer_after_minutes = 30 where id = ${eventTypeId}`
    await insertBooking('2030-09-09T09:00:00Z', '2030-09-09T09:30:00Z')
    await sql`update event_types set buffer_after_minutes = 0 where id = ${eventTypeId}`
    const { slotsFor } = await import('../services/booking-page')
    const slots = await slotsFor(await event(), '2030-09-09', '2030-09-09', '2030-09-01T00:00:00Z')
    expect(slots.some(slot => slot.start === '2030-09-09T09:30:00Z')).toBe(false)
    expect(slots.some(slot => slot.start === '2030-09-09T10:00:00Z')).toBe(true)
    await expect(insertBooking('2030-09-09T09:30:00Z', '2030-09-09T10:00:00Z')).rejects.toMatchObject({ code: '23P01' })
    await expect(insertBooking('2030-09-09T10:00:00Z', '2030-09-09T10:30:00Z')).resolves.toBeDefined()
  })

  it('protects a co-host on personal booking pages without any connected calendar', async () => {
    const [other] = await sql`insert into users (email, name, username) values ('organizer@example.com', 'Organizer', 'organizer') returning id`
    const [meeting] = await sql`insert into bookings (event_type_id, host_id, uid, starts_at, ends_at, attendee_name, attendee_email, attendee_time_zone)
      values (${eventTypeId}, ${other!.id}, ${crypto.randomUUID()}, '2030-09-09T09:00Z', '2030-09-09T10:00Z', 'Guest', 'guest@example.com', 'UTC') returning id`
    await sql`insert into booking_hosts (booking_id, user_id, starts_at, ends_at)
      values (${meeting!.id}, ${hostId}, '2030-09-09T09:00Z', '2030-09-09T10:00Z')`
    const { slotsFor } = await import('../services/booking-page')
    const slots = await slotsFor(await event(), '2030-09-09', '2030-09-09', '2030-09-01T00:00:00Z')
    expect(slots[0]!.start).toBe('2030-09-09T10:00:00Z')
  })

  it('allows only one winner when buffered reservations race', async () => {
    await sql`update event_types set buffer_after_minutes = 30 where id = ${eventTypeId}`
    const results = await Promise.allSettled([
      insertBooking('2030-09-09T09:00:00Z', '2030-09-09T09:30:00Z'),
      insertBooking('2030-09-09T09:30:00Z', '2030-09-09T10:00:00Z')
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: '23P01' } })
  })

  it('returns a recoverable conflict to the guest when concurrent booking requests overlap buffers', async () => {
    await sql`update event_types set buffer_after_minutes = 30 where id = ${eventTypeId}`
    const { createPersonalBooking } = await import('../services/personal-booking-creation')
    const results = await Promise.allSettled([
      createPersonalBooking({ ...request(), start: '2030-09-09T09:00:00Z' }),
      createPersonalBooking({ ...request(), start: '2030-09-09T09:30:00Z' })
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { statusCode: 409 } })
  })

  it('replays a recurring request after moving and cancelling an occurrence without creating or emailing again', async () => {
    await sql`update event_types set recurring_booking_enabled = true where id = ${eventTypeId}`
    const { createPersonalBooking } = await import('../services/personal-booking-creation')
    const originalRequest = {
      ...request(), requestId: crypto.randomUUID(),
      recurrence: { frequency: 'weekly' as const, occurrences: 2 }
    }
    const original = await createPersonalBooking(originalRequest)
    const moved = await createPersonalBooking({ ...request(), start: '2030-09-09T14:00:00Z', rescheduleOf: original.uid })
    await sql`update bookings set status = 'cancelled' where uid = ${moved.uid}`
    const [before] = await sql`select count(*)::int as count from email_outbox`
    const replay = await createPersonalBooking(originalRequest)
    expect(replay).toMatchObject({ uid: moved.uid, status: 'cancelled', replayed: true, seriesCount: 2 })
    expect(replay.occurrences?.[0]).toMatchObject({ uid: moved.uid, start: '2030-09-09T14:00:00.000Z', status: 'cancelled' })
    expect((await sql`select count(*)::int as count from bookings`)[0]!.count).toBe(3)
    expect((await sql`select count(*)::int as count from email_outbox`)[0]!.count).toBe(before!.count)
  })

  it('protects existing before-buffers across different event types and releases them on cancellation', async () => {
    await sql`update event_types set buffer_before_minutes = 30 where id = ${eventTypeId}`
    const old = await insertBooking('2030-09-09T10:00:00Z', '2030-09-09T10:30:00Z')
    const [otherEvent] = await sql`insert into event_types (user_id, slug, title, duration_minutes)
      values (${hostId}, 'other', 'Other event', 30) returning id`
    await expect(insertBooking('2030-09-09T09:30:00Z', '2030-09-09T10:00:00Z', otherEvent!.id)).rejects.toMatchObject({ code: '23P01' })
    await sql`update bookings set status = 'cancelled' where id = ${old.id}`
    await expect(insertBooking('2030-09-09T09:30:00Z', '2030-09-09T10:00:00Z', otherEvent!.id)).resolves.toBeDefined()
  })

  it('loads external busy time covering full-day buffers across extreme host timezone boundaries', async () => {
    await sql`update schedules set time_zone = 'Pacific/Kiritimati' where user_id = ${hostId}`
    await sql`update event_types set buffer_before_minutes = 1440 where id = ${eventTypeId}`
    const { calendarBusyTimes } = await import('../integrations/calendar/providers')
    const external = { start: '2030-09-07T20:00:00Z', end: '2030-09-07T21:00:00Z' }
    vi.mocked(calendarBusyTimes).mockImplementation(async (_user, from, to) =>
      Date.parse(external.end) > Date.parse(from) && Date.parse(external.start) < Date.parse(to) ? [external] : [])
    const { slotsFor } = await import('../services/booking-page')
    const slots = await slotsFor(await event(), '2030-09-09', '2030-09-09', '2030-09-01T00:00:00Z')
    expect(slots.some(slot => slot.start === '2030-09-08T19:00:00Z')).toBe(false)
    expect(slots.some(slot => slot.start === '2030-09-08T21:00:00Z')).toBe(true)
    expect(calendarBusyTimes).toHaveBeenCalledWith(hostId, '2030-09-07T00:00:00.000Z', '2030-09-12T00:00:00.000Z')

    await sql`update schedules set time_zone = 'Etc/GMT+12' where user_id = ${hostId}`
    await sql`update event_types set buffer_before_minutes = 0, buffer_after_minutes = 1440 where id = ${eventTypeId}`
    const later = { start: '2030-09-11T04:00:00Z', end: '2030-09-11T05:00:00Z' }
    vi.mocked(calendarBusyTimes).mockImplementation(async (_user, from, to) =>
      Date.parse(later.end) > Date.parse(from) && Date.parse(later.start) < Date.parse(to) ? [later] : [])
    const lateSlots = await slotsFor(await event(), '2030-09-09', '2030-09-09', '2030-09-01T00:00:00Z')
    expect(lateSlots.some(slot => slot.start === '2030-09-10T04:00:00Z')).toBe(false)
    expect(lateSlots.some(slot => slot.start === '2030-09-09T21:00:00Z')).toBe(true)
  })

  it('moves a team booking at its daily limit while protecting both old and new reservation state', async () => {
    const [team] = await sql`insert into organizations (name, slug) values ('Reliability team', 'reliability-team') returning id`
    await sql`insert into organization_subscriptions (organization_id, status) values (${team!.id}, 'active')`
    const [member] = await sql`insert into members (organization_id, user_id, role) values (${team!.id}, ${hostId}, 'owner') returning id`
    const [teamEvent] = await sql`insert into event_types (organization_id, created_by_user_id, slug, title, duration_minutes, assignment_mode,
      minimum_notice_minutes, booking_window_days, max_per_day, max_per_week, max_per_month)
      values (${team!.id}, ${hostId}, 'team-intro', 'Team intro', 30, 'collective', 0, null, 1, 1, 1) returning id`
    await sql`insert into event_type_hosts (event_type_id, member_id, user_id) values (${teamEvent!.id}, ${member!.id}, ${hostId})`
    const old = await insertBooking('2030-09-09T09:00:00Z', '2030-09-09T09:30:00Z', teamEvent!.id)
    await sql`update bookings set organization_id = ${team!.id} where id = ${old.id}`
    const { createTeamBooking } = await import('../services/team-booking-creation')
    const result = await createTeamBooking({ ...request(), team: 'reliability-team', slug: 'team-intro', rescheduleOf: old.uid })
    expect(result).toMatchObject({ moved: true, status: 'confirmed', start: '2030-09-09T12:00:00Z' })
    expect((await sql`select count(*)::int as count from booking_hosts where released_at is null`)[0]!.count).toBe(1)

    await sql`update bookings set status = 'cancelled'`
    await sql`update schedules set time_zone = 'Pacific/Kiritimati' where user_id = ${hostId}`
    await sql`update event_types set buffer_before_minutes = 1440 where id = ${teamEvent!.id}`
    const { calendarBusyTimes } = await import('../integrations/calendar/providers')
    const external = { start: '2030-09-07T20:00:00Z', end: '2030-09-07T21:00:00Z' }
    vi.mocked(calendarBusyTimes).mockImplementation(async (_user, from, to) =>
      Date.parse(external.end) > Date.parse(from) && Date.parse(external.start) < Date.parse(to) ? [external] : [])
    const { activeHostsFor, findPublicTeamEventType, teamSlotsFor } = await import('../services/team-booking')
    const config = (await findPublicTeamEventType('reliability-team', 'team-intro'))!
    const slots = await teamSlotsFor(config, await activeHostsFor(config.id), '2030-09-09', '2030-09-09', '2030-09-01T00:00:00Z')
    expect(slots.some(slot => slot.start === '2030-09-08T19:00:00Z')).toBe(false)
    expect(slots.some(slot => slot.start === '2030-09-08T21:00:00Z')).toBe(true)
    expect(calendarBusyTimes).toHaveBeenLastCalledWith(hostId, '2030-09-07T00:00:00.000Z', '2030-09-12T00:00:00.000Z')
  })
})
