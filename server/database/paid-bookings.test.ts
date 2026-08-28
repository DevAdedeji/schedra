import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestDatabaseUrl } from '../../test/helpers/database'

const url = getTestDatabaseUrl()

describe.skipIf(!url)('paid booking database invariants', () => {
  const sql = postgres(url!, { max: 3, onnotice: () => {} })
  let userId: string
  let eventTypeId: string
  let bookingId: string
  let recipientId: string

  afterAll(async () => {
    await sql`truncate table booking_payments, payment_recipients, bookings, event_types, users restart identity cascade`
    await sql.end()
  })

  beforeEach(async () => {
    await sql`truncate table booking_payments, payment_recipients, bookings, event_types, users restart identity cascade`
    const [user] = await sql<{ id: string }[]>`
      insert into users (email, name, username)
      values ('paid-host@example.com', 'Paid Host', 'paid-host') returning id
    `
    userId = user!.id
    const [eventType] = await sql<{ id: string }[]>`
      insert into event_types (
        user_id, slug, title, duration_minutes,
        payment_enabled, price_cents, payment_currency
      ) values (${userId}, 'paid-call', 'Paid call', 30, true, 2500, 'USD') returning id
    `
    eventTypeId = eventType!.id
    const [booking] = await sql<{ id: string }[]>`
      insert into bookings (
        event_type_id, host_id, uid, status, starts_at, ends_at,
        attendee_name, attendee_email, attendee_time_zone
      ) values (
        ${eventTypeId}, ${userId}, ${crypto.randomUUID()}, 'awaiting_payment',
        '2026-09-11T09:00:00Z', '2026-09-11T09:30:00Z',
        'Guest', 'guest@example.com', 'UTC'
      ) returning id
    `
    bookingId = booking!.id
    const [recipient] = await sql<{ id: string }[]>`
      insert into payment_recipients (user_id, bachs_account_id, status)
      values (${userId}, 'acct_paid_host', 'active') returning id
    `
    recipientId = recipient!.id
  })

  it('stores an immutable integer price snapshot for one booking', async () => {
    await sql`
      insert into booking_payments (
        booking_id, recipient_id, reference, amount_cents, currency, platform_fee_cents
      ) values (${bookingId}, ${recipientId}, 'booking-paid-1', 2500, 'USD', 125)
    `

    await expect(sql`
      insert into booking_payments (
        booking_id, recipient_id, reference, amount_cents, currency, platform_fee_cents
      ) values (${bookingId}, ${recipientId}, 'booking-paid-2', 3000, 'USD', 150)
    `).rejects.toMatchObject({ code: '23505' })
  })

  it('rejects ambiguous payout ownership and invalid platform fees', async () => {
    await expect(sql`
      insert into payment_recipients (bachs_account_id, status)
      values ('acct_ownerless', 'active')
    `).rejects.toMatchObject({ code: '23514' })

    await expect(sql`
      insert into booking_payments (
        booking_id, recipient_id, reference, amount_cents, currency, platform_fee_cents
      ) values (${bookingId}, ${recipientId}, 'booking-no-share', 2500, 'USD', 2500)
    `).rejects.toMatchObject({ code: '23514' })
  })

  it('prevents paid events from also requiring manual approval', async () => {
    await expect(sql`
      update event_types set requires_confirmation = true where id = ${eventTypeId}
    `).rejects.toMatchObject({ code: '23514' })
  })
})
