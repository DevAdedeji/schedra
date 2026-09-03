import { createBookingSchema } from '#shared/validation'
import { createPersonalBooking } from '../services/personal-booking-creation'
import { enforceRateLimit } from '../services/rate-limit'

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, { namespace: 'create-booking', limit: 12, windowSeconds: 600 })
  const parsed = await readValidatedBody(event, createBookingSchema.safeParse)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? 'Those booking details are not valid.'
    })
  }

  return createPersonalBooking(parsed.data)
})
