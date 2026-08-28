import { requireOrganization } from '../../../../services/organization'
import { listRoutingForms, routingEventOptions } from '../../../../services/routing-forms'

export default defineEventHandler(async (event) => {
  const context = await requireOrganization(event, getRouterParam(event, 'slug') ?? '')
  const owner = { organizationId: context.organization.id } as const
  const [items, eventTypes] = await Promise.all([listRoutingForms(owner), routingEventOptions(owner)])
  return { items, eventTypes }
})
