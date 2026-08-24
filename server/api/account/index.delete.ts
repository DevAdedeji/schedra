import { eq } from 'drizzle-orm'
import { deleteAccountSchema } from '#shared/validation'
import { users } from '../../database/schema'
import { useDatabase } from '../../utils/database'
import { requireAuthSession } from '../../utils/session'
import { disconnectGoogleCalendar } from '../../utils/google-calendar'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const parsed = await readValidatedBody(event, deleteAccountSchema.safeParse)
  if (!parsed.success || parsed.data.email.toLowerCase() !== session.user.email.toLowerCase()) {
    throw createError({ statusCode: 400, statusMessage: 'Enter your account email and DELETE exactly to continue.' })
  }
  await disconnectGoogleCalendar(session.user.id)
  const deleted = await useDatabase().delete(users).where(eq(users.id, session.user.id)).returning({ id: users.id })
  if (!deleted.length) throw createError({ statusCode: 404, statusMessage: 'Your account could not be found.' })
  return { ok: true }
})
