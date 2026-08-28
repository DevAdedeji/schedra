import { getRoutingForm } from '../../services/routing-forms'
import { requireAuthSession } from '../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const form = await getRoutingForm({ userId: session.user.id }, getRouterParam(event, 'id') ?? '')
  if (!form) throw createError({ statusCode: 404, statusMessage: 'Routing form not found.' })
  return form
})
