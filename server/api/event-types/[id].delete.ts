import { and, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { bookings, eventTypes } from '../../database/schema'
import { useDatabase } from '../../utils/database'
import { requireAuthSession } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))

  if (!id.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid event type.' })
  }

  const db = useDatabase()
  const [owned] = await db
    .select({ id: eventTypes.id })
    .from(eventTypes)
    .where(and(eq(eventTypes.id, id.data), eq(eventTypes.userId, session.user.id)))
    .limit(1)

  if (!owned) {
    throw createError({ statusCode: 404, statusMessage: 'No such event type.' })
  }

  const [history] = await db
    .select({ value: count() })
    .from(bookings)
    .where(eq(bookings.eventTypeId, id.data))

  if ((history?.value ?? 0) > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This event type has booking history. Hide it instead so past bookings stay intact.'
    })
  }

  try {
    await db.delete(eventTypes).where(and(eq(eventTypes.id, id.data), eq(eventTypes.userId, session.user.id)))
  } catch (error) {
    if ((error as { code?: string }).code === '23503') {
      throw createError({
        statusCode: 409,
        statusMessage: 'This event type has booking history. Hide it instead so past bookings stay intact.'
      })
    }
    throw error
  }
  setResponseStatus(event, 204)
  return null
})
