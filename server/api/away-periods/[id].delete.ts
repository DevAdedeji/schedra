import { z } from 'zod'
import { deleteAwayPeriod } from '../../services/away-periods'
import { requireAuthSession } from '../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 400, statusMessage: 'Invalid away period.' })
  if (!await deleteAwayPeriod(session.user.id, id.data)) {
    throw createError({ statusCode: 404, statusMessage: 'Away period not found.' })
  }
  setResponseStatus(event, 204)
  return null
})
