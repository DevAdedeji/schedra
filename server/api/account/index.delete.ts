import { eq } from 'drizzle-orm'
import { deleteAccountSchema } from '#shared/validation'
import { members, users } from '../../database/schema'
import { useDatabase } from '../../database/index'
import { requireAuthSession } from '../../services/session'
import { disconnectGoogleCalendar } from '../../integrations/calendar/google'
import { disconnectMicrosoftCalendar } from '../../integrations/calendar/microsoft'
import { disconnectZoom } from '../../integrations/video/zoom'
import { activeTeamsOwnedBy } from '../../services/organization'
import { useAuth } from '../../services/auth'
import { enqueueSubscriptionSeatSync } from '../../services/subscription-seat-sync'
import { recordSecurityAudit } from '../../services/security-audit'

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

  const db = useDatabase()
  const memberships = await db.select({ organizationId: members.organizationId })
    .from(members)
    .where(eq(members.userId, session.user.id))

  await disconnectGoogleCalendar(session.user.id)
  await disconnectMicrosoftCalendar(session.user.id)
  await disconnectZoom(session.user.id)
  await db.transaction(async (tx) => {
    // Write this before deleting the user so the foreign key is valid. The
    // deletion then nulls actorUserId while actorEmail preserves attribution.
    const audited = await recordSecurityAudit({
      action: 'account.deleted',
      actorUserId: session.user.id,
      actorEmail: session.user.email,
      targetType: 'user',
      targetId: session.user.id
    }, event, tx)
    if (!audited) {
      throw createError({ statusCode: 503, statusMessage: 'Account deletion could not be safely audited. Please try again.' })
    }

    const rows = await tx.delete(users).where(eq(users.id, session.user.id)).returning({ id: users.id })
    if (!rows.length) {
      throw createError({ statusCode: 404, statusMessage: 'Your account could not be found.' })
    }
    for (const membership of memberships) {
      await enqueueSubscriptionSeatSync(membership.organizationId, tx)
    }
    return rows
  })

  // Database cascades remove the session row, but Better Auth's signed cookie
  // cache can otherwise keep authorizing this browser for a few minutes. Run
  // its sign-out endpoint as well and forward every cookie-clearing header.
  const signedOut = await useAuth().api.signOut({ headers: event.headers, returnHeaders: true })
  for (const cookie of signedOut.headers.getSetCookie()) {
    appendResponseHeader(event, 'set-cookie', cookie)
  }

  return { ok: true }
})
