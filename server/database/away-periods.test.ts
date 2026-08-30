import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { configureAppTestEnvironment, getTestDatabaseUrl } from '../../test/helpers/database'

const url = getTestDatabaseUrl()

describe.skipIf(!url)('away periods', () => {
  const sql = postgres(url!, { max: 3, onnotice: () => {} })
  let ownerId: string
  let otherUserId: string

  beforeEach(async () => {
    configureAppTestEnvironment(url!)
    const { resetEnv } = await import('../config/env')
    resetEnv()
    await sql`truncate table away_periods, users, organizations restart identity cascade`
    const users = await sql<{ id: string }[]>`
      insert into users (email, name, username, time_zone) values
        ('away-owner@example.com', 'Away Owner', 'away-owner', 'America/New_York'),
        ('away-other@example.com', 'Away Other', 'away-other', 'UTC')
      returning id
    `
    ownerId = users[0]!.id
    otherUserId = users[1]!.id
  })

  afterAll(async () => {
    await sql`truncate table away_periods, users, organizations restart identity cascade`
    await sql.end()
  })

  it('captures the account timezone and lets only the owner update or delete a period', async () => {
    const { createAwayPeriod, deleteAwayPeriod, updateAwayPeriod } = await import('../services/away-periods')
    const created = await createAwayPeriod(ownerId, {
      name: 'Annual leave',
      startDate: '2026-09-01',
      endDate: '2026-09-05'
    })
    expect(created).toMatchObject({ timeZone: 'America/New_York', conflictingBookingCount: 0 })

    await expect(updateAwayPeriod(otherUserId, created.id, {
      name: 'Changed by another user',
      startDate: '2026-09-01',
      endDate: '2026-09-05'
    })).resolves.toBeNull()
    await expect(deleteAwayPeriod(otherUserId, created.id)).resolves.toBe(false)

    const [stored] = await sql<{ name: string }[]>`select name from away_periods where id = ${created.id}`
    expect(stored?.name).toBe('Annual leave')
  })

  it('rejects reversed and overlapping date ranges at the database boundary', async () => {
    await sql`
      insert into away_periods (user_id, name, start_date, end_date, time_zone)
      values (${ownerId}, 'First break', '2026-10-10', '2026-10-15', 'UTC')
    `

    await expect(sql`
      insert into away_periods (user_id, name, start_date, end_date, time_zone)
      values (${ownerId}, 'Reversed', '2026-10-20', '2026-10-19', 'UTC')
    `).rejects.toMatchObject({ code: '23514' })
    await expect(sql`
      insert into away_periods (user_id, name, start_date, end_date, time_zone)
      values (${ownerId}, 'Overlap', '2026-10-15', '2026-10-17', 'UTC')
    `).rejects.toMatchObject({ code: '23P01' })
  })
})
