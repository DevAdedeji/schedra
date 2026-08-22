import { and, eq, inArray } from 'drizzle-orm'
import { cancelBookingSchema } from '#shared/validation'
import { bookings } from '../../../database/schema'
import { useDatabase } from '../../../utils/database'
import { findBookingByUid } from '../../../utils/booking-manage'
import { queueCancellationEmails } from '../../../utils/booking-emails'
import { getAuthSession } from '../../../utils/session'
import { enforceRateLimit } from '../../../utils/rate-limit'

export default defineEventHandler(async (event) => {
  const uid = getRouterParam(event, 'uid')
  await enforceRateLimit(event, {
    namespace: 'cancel-booking',
    identity: uid,
    limit: 20,
    windowSeconds: 600
  })
  const parsed = await readValidatedBody(event, cancelBookingSchema.safeParse)

  if (!uid || !parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid cancellation' })
  }

  const booking = await findBookingByUid(uid)

  if (!booking) {
    throw createError({ statusCode: 404, statusMessage: 'No such booking' })
  }

  if (booking.status === 'cancelled') {
    return { ok: true, alreadyCancelled: true }
  }

  if (booking.endsAt.getTime() < Date.now()) {
    throw createError({ statusCode: 409, statusMessage: 'That meeting has already happened.' })
  }

  const session = await getAuthSession(event)
  const actor = session?.user.id === booking.hostId ? 'host' : 'guest'
  const cancelled = await useDatabase().transaction(async (tx) => {
    const [updated] = await tx
      .update(bookings)
      .set({
        status: 'cancelled',
        cancellationReason: parsed.data.reason || null,
        updatedAt: new Date()
      })
      .where(and(
        eq(bookings.id, booking.id),
        inArray(bookings.status, ['pending', 'confirmed'])
      ))
      .returning({ id: bookings.id })

    if (!updated) return false

    await queueCancellationEmails(booking, parsed.data.reason, actor, tx)
    return true
  })

  if (!cancelled) {
    return { ok: true, alreadyCancelled: true }
  }

  return { ok: true, alreadyCancelled: false }
})
