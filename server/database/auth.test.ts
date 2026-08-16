import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const url = process.env.DATABASE_URL

/**
 * Exercises better-auth against the real schema. The point is to catch a
 * mismatch between what better-auth writes and what the tables accept —
 * a missing column or wrong id type fails here rather than on someone's
 * first sign-up.
 */
describe.skipIf(!url)('authentication', () => {
  const sql = postgres(url!, { max: 3, onnotice: () => {} })

  const credentials = {
    name: 'Ada Lovelace',
    username: 'ada',
    email: 'ada@example.com',
    password: 'a-long-enough-passphrase',
    timeZone: 'Africa/Lagos'
  }

  async function auth() {
    process.env.SCHEDRA_URL ||= 'http://localhost:3000'
    process.env.AUTH_SECRET ||= 'x'.repeat(32)
    const { resetEnv } = await import('../utils/env')
    resetEnv()
    const { useAuth } = await import('../utils/auth')
    return useAuth()
  }

  /** Stands in for the visitor clicking the link in their inbox. */
  async function confirmEmail(email: string) {
    await sql`update users set email_verified = true where email = ${email}`
  }

  afterAll(() => sql.end())

  beforeEach(async () => {
    await sql`truncate table sessions, accounts, verifications, bookings, event_types, schedules, users, organizations restart identity cascade`
  })

  it('creates an unverified user and a hashed credentials account', async () => {
    const result = await (await auth()).api.signUpEmail({ body: credentials })

    expect(result.user.email).toBe(credentials.email)

    const [user] = await sql<{ id: string, username: string, time_zone: string, email_verified: boolean }[]>`
      select id, username, time_zone, email_verified from users where email = ${credentials.email}
    `
    expect(user?.username).toBe('ada')
    expect(user?.time_zone).toBe('Africa/Lagos')
    expect(user?.email_verified).toBe(false)

    const accounts = await sql`select provider_id, password from accounts where user_id = ${user!.id}`
    expect(accounts).toHaveLength(1)
    expect(accounts[0]!.provider_id).toBe('credential')
    expect(accounts[0]!.password).not.toContain(credentials.password)
  })

  it('refuses sign-in until the email is confirmed', async () => {
    const instance = await auth()
    await instance.api.signUpEmail({ body: credentials })

    await expect(
      instance.api.signInEmail({
        body: { email: credentials.email, password: credentials.password }
      })
    ).rejects.toThrow()
  })

  it('signs in once the email is confirmed', async () => {
    const instance = await auth()
    await instance.api.signUpEmail({ body: credentials })
    await confirmEmail(credentials.email)

    const signedIn = await instance.api.signInEmail({
      body: { email: credentials.email, password: credentials.password }
    })

    expect(signedIn.user.email).toBe(credentials.email)

    const sessions = await sql`select id from sessions`
    expect(sessions.length).toBeGreaterThan(0)
  })

  it('rejects the wrong password', async () => {
    const instance = await auth()
    await instance.api.signUpEmail({ body: credentials })
    await confirmEmail(credentials.email)

    await expect(
      instance.api.signInEmail({
        body: { email: credentials.email, password: 'not-the-password' }
      })
    ).rejects.toThrow()
  })

  /**
   * Signing up again on an unverified address deliberately succeeds rather
   * than erroring — better-auth re-sends the confirmation instead of
   * confirming to a stranger that the address is registered. What must not
   * happen is a second row.
   */
  it('does not duplicate the user when signing up twice on one email', async () => {
    const instance = await auth()
    await instance.api.signUpEmail({ body: credentials })
    await instance.api.signUpEmail({ body: { ...credentials, username: 'ada2' } })

    const rows = await sql`select id from users where email = ${credentials.email}`
    expect(rows).toHaveLength(1)
  })

  it.each([
    ['slashes that would break the booking URL', 'ada/../admin'],
    ['a reserved word', 'dashboard'],
    ['far too long', 'a'.repeat(40)],
    ['a leading hyphen', '-ada']
  ])('rejects %s posted straight to the endpoint, bypassing the form', async (_label, username) => {
    const instance = await auth()

    await expect(
      instance.api.signUpEmail({ body: { ...credentials, username } })
    ).rejects.toThrow()

    const rows = await sql`select id from users`
    expect(rows).toHaveLength(0)
  })

  /** Mirrors a Google sign-up, which brings a name but no username. */
  it('derives a valid username when none is supplied', async () => {
    const instance = await auth()
    await instance.api.signUpEmail({
      body: {
        name: 'Ada Lovelace',
        email: 'ada2@example.com',
        password: credentials.password
      } as typeof credentials
    })

    const [row] = await sql<{ username: string }[]>`select username from users`
    expect(row?.username).toBe('ada-lovelace')
  })

  it('sidesteps a username already in use when deriving', async () => {
    const instance = await auth()
    await instance.api.signUpEmail({ body: { ...credentials, username: 'ada-lovelace' } })

    await instance.api.signUpEmail({
      body: {
        name: 'Ada Lovelace',
        email: 'ada2@example.com',
        password: credentials.password
      } as typeof credentials
    })

    const rows = await sql<{ username: string }[]>`select username from users order by created_at`
    expect(rows.map(row => row.username)).toEqual(['ada-lovelace', 'ada-lovelace-2'])
  })
})
