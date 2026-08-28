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
    await sql`truncate table payment_ledger_entries, booking_payments, payment_recipients, bookings, event_types, users restart identity cascade`
    await sql.end()
  })

  beforeEach(async () => {
    await sql`truncate table payment_ledger_entries, booking_payments, payment_recipients, bookings, event_types, users restart identity cascade`
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

  it('keeps payment history append-only and deduplicates provider retries', async () => {
    const [payment] = await sql<{ id: string }[]>`
      insert into booking_payments (
        booking_id, recipient_id, reference, amount_cents, currency, platform_fee_cents
      ) values (${bookingId}, ${recipientId}, 'booking-ledger-1', 2500, 'USD', 125)
      returning id
    `
    const [entry] = await sql<{ id: string }[]>`
      insert into payment_ledger_entries (
        booking_payment_id, dedupe_key, kind, direction, status,
        amount_cents, currency, provider_event_id, message
      ) values (
        ${payment!.id}, 'payment:provider:event-1', 'customer_payment', 'in', 'succeeded',
        2500, 'USD', 'event-1', 'Customer payment confirmed.'
      ) returning id
    `

    await expect(sql`
      insert into payment_ledger_entries (
        booking_payment_id, dedupe_key, kind, direction, status, amount_cents, currency
      ) values (${payment!.id}, 'payment:provider:event-1', 'customer_payment', 'in', 'succeeded', 2500, 'USD')
    `).rejects.toMatchObject({ code: '23505' })

    await expect(sql`
      update payment_ledger_entries set message = 'changed' where id = ${entry!.id}
    `).rejects.toMatchObject({ code: 'P0001' })
    await expect(sql`
      delete from payment_ledger_entries where id = ${entry!.id}
    `).rejects.toMatchObject({ code: 'P0001' })
  })

  it('rejects invalid money movement classifications', async () => {
    const [payment] = await sql<{ id: string }[]>`
      insert into booking_payments (
        booking_id, recipient_id, reference, amount_cents, currency, platform_fee_cents
      ) values (${bookingId}, ${recipientId}, 'booking-ledger-2', 2500, 'USD', 125)
      returning id
    `
    await expect(sql`
      insert into payment_ledger_entries (
        booking_payment_id, dedupe_key, kind, direction, status, amount_cents, currency
      ) values (${payment!.id}, 'payment:invalid', 'cash', 'sideways', 'lost', -1, 'BTC')
    `).rejects.toMatchObject({ code: '23514' })
  })
})
