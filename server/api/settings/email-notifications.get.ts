import { requireAuthSession } from '../../services/session'
import { emailPreferencesForUser } from '../../services/email-notification-preferences'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  return emailPreferencesForUser(session.user.id)
})
