import { emailNotificationPreferencesSchema } from '#shared/email-notification-preferences'
import { requireAuthSession } from '../../services/session'
import { saveEmailPreferences } from '../../services/email-notification-preferences'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const parsed = await readValidatedBody(event, emailNotificationPreferencesSchema.safeParse)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? 'Check those notification settings.'
    })
  }
  return saveEmailPreferences(session.user.id, parsed.data)
})
