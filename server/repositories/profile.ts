import { and, eq, isNotNull } from 'drizzle-orm'
import { accounts, users } from '../database/schema'
import { useDatabase } from '../database'

export async function profileForUser(userId: string) {
  const database = useDatabase()
  const [profile] = await database.select({
    id: users.id,
    name: users.name,
    email: users.email,
    emailVerified: users.emailVerified,
    username: users.username,
    timeZone: users.timeZone,
    bio: users.bio,
    avatarUrl: users.avatarUrl,
    twoFactorEnabled: users.twoFactorEnabled
  }).from(users).where(eq(users.id, userId)).limit(1)

  if (!profile) return null

  const [passwordAccount] = await database.select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), isNotNull(accounts.password)))
    .limit(1)

  return { ...profile, hasPassword: Boolean(passwordAccount) }
}
