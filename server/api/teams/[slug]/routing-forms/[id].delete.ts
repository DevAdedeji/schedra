import { assertTeamWritable } from '../../../../services/entitlement'
import { requireOrganizationPermission } from '../../../../services/organization'
import { deleteRoutingForm } from '../../../../services/routing-forms'

export default defineEventHandler(async (event) => {
  const context = await requireOrganizationPermission(event, getRouterParam(event, 'slug') ?? '', { eventType: ['delete'] })
  await assertTeamWritable(context.organization.id)
  const deleted = await deleteRoutingForm({ organizationId: context.organization.id }, getRouterParam(event, 'id') ?? '')
  if (!deleted) throw createError({ statusCode: 404, statusMessage: 'Routing form not found.' })
  setResponseStatus(event, 204)
  return null
})
