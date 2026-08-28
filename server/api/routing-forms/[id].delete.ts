import { deleteRoutingForm } from '../../services/routing-forms'
import { requireAuthSession } from '../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const deleted = await deleteRoutingForm({ userId: session.user.id }, getRouterParam(event, 'id') ?? '')
  if (!deleted) throw createError({ statusCode: 404, statusMessage: 'Routing form not found.' })
  setResponseStatus(event, 204)
  return null
})
