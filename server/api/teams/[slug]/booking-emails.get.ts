import { teamBookingEmailTemplateSettings } from '../../../services/booking-email-template-settings'
import { requireOrganization } from '../../../services/organization'
import { storedTeamBranding } from '../../../services/team-branding'

export default defineEventHandler(async (event) => {
  const context = await requireOrganization(event, getRouterParam(event, 'slug') ?? '')
  const [settings, branding] = await Promise.all([
    teamBookingEmailTemplateSettings(context.organization.id),
    storedTeamBranding(context.organization.id)
  ])
  return { settings, branding }
})
