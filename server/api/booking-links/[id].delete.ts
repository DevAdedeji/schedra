import { z } from 'zod'
import { revokeOwnedBookingLink } from '../../services/booking-links'
import { requireAuthSession } from '../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 400, statusMessage: 'Invalid meeting link.' })
  await revokeOwnedBookingLink(session.user.id, id.data)
  return { revoked: true }
})
