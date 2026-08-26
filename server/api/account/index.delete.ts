import { eq } from 'drizzle-orm'
import { deleteAccountSchema } from '#shared/validation'
import { users } from '../../database/schema'
import { useDatabase } from '../../utils/database'
import { requireAuthSession } from '../../utils/session'
import { disconnectGoogleCalendar } from '../../utils/google-calendar'
import { useAuth } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const parsed = await readValidatedBody(event, deleteAccountSchema.safeParse)
  if (!parsed.success || parsed.data.email.toLowerCase() !== session.user.email.toLowerCase()) {
    throw createError({ statusCode: 400, statusMessage: 'Enter your account email and DELETE exactly to continue.' })
  }
  await disconnectGoogleCalendar(session.user.id)
  const deleted = await useDatabase().delete(users).where(eq(users.id, session.user.id)).returning({ id: users.id })
  if (!deleted.length) throw createError({ statusCode: 404, statusMessage: 'Your account could not be found.' })

  // Database cascades remove the session row, but Better Auth's signed cookie
  // cache can otherwise keep authorizing this browser for a few minutes. Run
  // its sign-out endpoint as well and forward every cookie-clearing header.
  const signedOut = await useAuth().api.signOut({ headers: event.headers, returnHeaders: true })
  for (const cookie of signedOut.headers.getSetCookie()) {
    appendResponseHeader(event, 'set-cookie', cookie)
  }

  return { ok: true }
})
