import { personalBookingEmailTemplateSettings } from '../../services/booking-email-template-settings'
import { storedPersonalBranding } from '../../services/personal-branding'
import { requireAuthSession } from '../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const [settings, stored] = await Promise.all([
    personalBookingEmailTemplateSettings(session.user.id),
    storedPersonalBranding(session.user.id)
  ])
  return { settings, branding: stored.branding, entitlement: stored.entitlement }
})
