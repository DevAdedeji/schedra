import { createTeamBookingSchema } from '#shared/validation'
import { createTeamBooking } from '../services/team-booking-creation'
import { enforceRateLimit } from '../services/rate-limit'

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, { namespace: 'create-team-booking', limit: 12, windowSeconds: 600 })
  const parsed = await readValidatedBody(event, createTeamBookingSchema.safeParse)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? 'Those booking details are not valid.'
    })
  }

  return createTeamBooking(parsed.data)
})
