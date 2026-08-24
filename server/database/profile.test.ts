import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { configureAppTestEnvironment, getTestDatabaseUrl } from '../../test/helpers/database'

const url = getTestDatabaseUrl()

describe.skipIf(!url)('profile persistence', () => {
  const sql = postgres(url!, { max: 2, onnotice: () => {} })

  beforeEach(async () => {
    configureAppTestEnvironment(url!)
    await sql`
      truncate table email_outbox, api_rate_limits, rate_limits, sessions,
        accounts, verifications, bookings, event_types, date_overrides,
        availability_rules, schedules, users, organizations
      restart identity cascade
    `
  })

  afterAll(async () => {
    await sql.end()
  })

  it('reads editable fields from the database instead of a cached session snapshot', async () => {
    const [user] = await sql<{ id: string }[]>`
      insert into users (email, name, username, bio, time_zone)
      values ('profile@example.com', 'Original Name', 'profile', null, 'Africa/Lagos')
      returning id
    `
    const { profileForUser } = await import('../utils/profile')

    await sql`
      update users
      set name = 'Updated Name', bio = 'A bio that must survive a refresh.'
      where id = ${user!.id}
    `

    await expect(profileForUser(user!.id)).resolves.toMatchObject({
      name: 'Updated Name',
      bio: 'A bio that must survive a refresh.',
      timeZone: 'Africa/Lagos'
    })
  })
})
