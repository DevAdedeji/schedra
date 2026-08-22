import { and, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { eventTypes, schedules } from '../../database/schema'
import { useDatabase } from '../../utils/database'
import { requireAuthSession } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 400, statusMessage: 'Invalid schedule.' })

  const db = useDatabase()
  const [schedule] = await db.select({ id: schedules.id, isDefault: schedules.isDefault }).from(schedules)
    .where(and(eq(schedules.id, id.data), eq(schedules.userId, session.user.id))).limit(1)
  if (!schedule) throw createError({ statusCode: 404, statusMessage: 'No such schedule.' })
  if (schedule.isDefault) {
    throw createError({ statusCode: 409, statusMessage: 'Choose another default schedule before deleting this one.' })
  }
  const [assigned] = await db.select({ value: count() }).from(eventTypes)
    .where(and(eq(eventTypes.userId, session.user.id), eq(eventTypes.scheduleId, id.data)))
  if ((assigned?.value ?? 0) > 0) {
    throw createError({ statusCode: 409, statusMessage: 'Reassign the event types using this schedule before deleting it.' })
  }
  await db.delete(schedules).where(and(eq(schedules.id, id.data), eq(schedules.userId, session.user.id)))
  setResponseStatus(event, 204)
  return null
})
