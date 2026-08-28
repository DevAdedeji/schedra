import { requireOrganization } from '../../../../services/organization'
import { getRoutingForm } from '../../../../services/routing-forms'

export default defineEventHandler(async (event) => {
  const context = await requireOrganization(event, getRouterParam(event, 'slug') ?? '')
  const form = await getRoutingForm({ organizationId: context.organization.id }, getRouterParam(event, 'id') ?? '')
  if (!form) throw createError({ statusCode: 404, statusMessage: 'Routing form not found.' })
  return form
})
