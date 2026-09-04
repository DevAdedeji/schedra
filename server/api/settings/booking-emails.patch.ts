import { bookingEmailTemplateSettingsSchema } from '#shared/email-templates'
import { savePersonalBookingEmailTemplateSettings } from '../../services/booking-email-template-settings'
import { assertPersonalPro } from '../../services/personal-entitlement'
import { requireAuthSession } from '../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  await assertPersonalPro(session.user.id)
  const parsed = await readValidatedBody(event, bookingEmailTemplateSettingsSchema.safeParse)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? 'Check the email template settings.'
    })
  }
  return { settings: await savePersonalBookingEmailTemplateSettings(session.user.id, parsed.data) }
})
