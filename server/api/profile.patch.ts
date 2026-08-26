import { eq, sql } from 'drizzle-orm'
import { updateProfileSchema } from '#shared/validation'
import { users } from '../database/schema'
import { useDatabase } from '../database/index'
import { requireAuthSession } from '../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const parsed = await readValidatedBody(event, updateProfileSchema.safeParse)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? 'Those details are not valid.'
    })
  }

  const { name, bio, timeZone } = parsed.data

  const [updated] = await useDatabase()
    .update(users)
    .set({
      name,
      bio: bio || null,
      ...(timeZone ? { timeZone } : {}),
      updatedAt: sql`now()`
    })
    .where(eq(users.id, session.user.id))
    .returning({
      id: users.id,
      name: users.name,
      email: users.email,
      username: users.username,
      timeZone: users.timeZone,
      bio: users.bio,
      avatarUrl: users.avatarUrl
    })

  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Your profile could not be found.' })
  return { ok: true, user: updated }
})
