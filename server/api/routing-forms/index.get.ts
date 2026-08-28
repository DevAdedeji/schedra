import { requireAuthSession } from '../../services/session'
import { listRoutingForms, routingEventOptions } from '../../services/routing-forms'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const owner = { userId: session.user.id } as const
  const [items, eventTypes] = await Promise.all([
    listRoutingForms(owner),
    routingEventOptions(owner)
  ])
  return { items, eventTypes }
})
