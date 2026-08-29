import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestDatabaseUrl } from '../../test/helpers/database'

const url = getTestDatabaseUrl()

describe.skipIf(!url)('payment withdrawal database invariants', () => {
  const sql = postgres(url!, { max: 3, onnotice: () => {} })
  let userId: string
  let recipientId: string

  afterAll(async () => {
    await sql`truncate table payment_withdrawals, payment_recipients, users restart identity cascade`
    await sql.end()
  })

  beforeEach(async () => {
    await sql`truncate table payment_withdrawals, payment_recipients, users restart identity cascade`
    const [user] = await sql<{ id: string }[]>`
      insert into users (email, name, username)
      values ('withdrawal-owner@example.com', 'Withdrawal Owner', 'withdrawal-owner') returning id
    `
    userId = user!.id
    const [recipient] = await sql<{ id: string }[]>`
      insert into payment_recipients (user_id, bachs_account_id, status)
      values (${userId}, 'acct_withdrawal_owner', 'active') returning id
    `
    recipientId = recipient!.id
  })

  it('deduplicates both the Schedra request and provider payout', async () => {
    const requestId = crypto.randomUUID()
    await sql`
      insert into payment_withdrawals (
        id, recipient_id, requested_by_user_id, reference, bachs_payout_id,
        destination_id, destination_name, source_currency, destination_currency,
        requested_amount_cents, status
      ) values (
        ${requestId}, ${recipientId}, ${userId}, 'schedra-wd-1', 'pay_1',
        'pd_1', 'Primary bank', 'NGN', 'NGN', 500000, 'pending'
      )
    `

    await expect(sql`
      insert into payment_withdrawals (
        id, recipient_id, reference, bachs_payout_id, destination_id,
        destination_name, source_currency, destination_currency,
        requested_amount_cents, status
      ) values (
        ${crypto.randomUUID()}, ${recipientId}, 'schedra-wd-2', 'pay_1', 'pd_1',
        'Primary bank', 'NGN', 'NGN', 500000, 'pending'
      )
    `).rejects.toMatchObject({ code: '23505' })
  })

  it('rejects invalid financial states and amounts', async () => {
    await expect(sql`
      insert into payment_withdrawals (
        id, recipient_id, reference, destination_id, destination_name,
        source_currency, destination_currency, requested_amount_cents, status
      ) values (
        ${crypto.randomUUID()}, ${recipientId}, 'schedra-wd-invalid', 'pd_1', 'Primary bank',
        'BTC', 'NGN', -1, 'lost'
      )
    `).rejects.toMatchObject({ code: '23514' })
  })

  it('removes private withdrawal records when their owning account is deleted', async () => {
    await sql`
      insert into payment_withdrawals (
        id, recipient_id, reference, destination_id, destination_name,
        source_currency, destination_currency, requested_amount_cents
      ) values (
        ${crypto.randomUUID()}, ${recipientId}, 'schedra-wd-history', 'pd_1', 'Primary bank',
        'USD', 'NGN', 500
      )
    `

    await sql`delete from payment_recipients where id = ${recipientId}`
    const [remaining] = await sql<{ count: number }[]>`
      select count(*)::int as count from payment_withdrawals where recipient_id = ${recipientId}
    `
    expect(remaining?.count).toBe(0)
  })
})
