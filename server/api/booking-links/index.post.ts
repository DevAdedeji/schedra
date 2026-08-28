import { createBookingLinkSchema } from '#shared/booking-links'
import { createBookingLink } from '../../services/booking-links'
import { requireAuthSession } from '../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const parsed = await readValidatedBody(event, createBookingLinkSchema.safeParse)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Invalid meeting link.' })
  }
  return createBookingLink(session.user.id, parsed.data)
})
