import { eq } from 'drizzle-orm'
import { users } from '../database/schema'
import { useDatabase } from './database'

export async function profileForUser(userId: string) {
  const [profile] = await useDatabase().select({
    id: users.id,
    name: users.name,
    email: users.email,
    emailVerified: users.emailVerified,
    username: users.username,
    timeZone: users.timeZone,
    bio: users.bio,
    avatarUrl: users.avatarUrl
  }).from(users).where(eq(users.id, userId)).limit(1)

  return profile ?? null
}
