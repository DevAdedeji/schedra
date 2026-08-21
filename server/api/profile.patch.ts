import { eq } from 'drizzle-orm'
import { updateProfileSchema } from '#shared/validation'
import { users } from '../database/schema'
import { useDatabase } from '../utils/database'
import { requireAuthSession } from '../utils/session'

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

  await useDatabase()
    .update(users)
    .set({
      name,
      bio: bio || null,
      ...(timeZone ? { timeZone } : {}),
      updatedAt: new Date()
    })
    .where(eq(users.id, session.user.id))

  return { ok: true }
})
