import { requireOrganization } from '../../../services/organization'
import { storedTeamBranding } from '../../../services/team-branding'

export default defineEventHandler(async (event) => {
  const context = await requireOrganization(event, getRouterParam(event, 'slug') ?? '')
  return { branding: await storedTeamBranding(context.organization.id) }
})
