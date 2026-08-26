import { eq } from 'drizzle-orm'
import { deleteAccountSchema } from '#shared/validation'
import { users } from '../../database/schema'
import { useDatabase } from '../../database/index'
import { requireAuthSession } from '../../services/session'
import { disconnectGoogleCalendar } from '../../integrations/calendar/google'
import { activeTeamsOwnedBy } from '../../services/organization'
import { useAuth } from '../../services/auth'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const parsed = await readValidatedBody(event, deleteAccountSchema.safeParse)
  if (!parsed.success || parsed.data.email.toLowerCase() !== session.user.email.toLowerCase()) {
    throw createError({ statusCode: 400, statusMessage: 'Enter your account email and DELETE exactly to continue.' })
  }

  // Deleting the account would cascade the membership away and leave the
  // team ownerless, so the handover has to happen first.
  const owned = await activeTeamsOwnedBy(session.user.id)

  if (owned.length) {
    throw createError({
      statusCode: 409,
      statusMessage: `Transfer ownership or archive ${owned.map(row => row.name).join(', ')} before deleting your account.`
    })
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
