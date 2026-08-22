import { count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { timeZoneSchema } from '#shared/validation'
import { availabilityRules, schedules } from '../database/schema'
import { useDatabase } from '../utils/database'
import { requireAuthSession } from '../utils/session'

const createScheduleSchema = z.object({
  name: z.string().trim().min(1).max(60),
  timeZone: timeZoneSchema
})

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const parsed = await readValidatedBody(event, createScheduleSchema.safeParse)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Invalid schedule.' })
  }

  const db = useDatabase()
  const [total] = await db.select({ value: count() }).from(schedules).where(eq(schedules.userId, session.user.id))
  if ((total?.value ?? 0) >= 10) {
    throw createError({ statusCode: 409, statusMessage: 'You can create up to 10 schedules.' })
  }

  const created = await db.transaction(async (tx) => {
    const [schedule] = await tx.insert(schedules).values({
      userId: session.user.id,
      name: parsed.data.name,
      timeZone: parsed.data.timeZone,
      isDefault: (total?.value ?? 0) === 0
    }).returning({ id: schedules.id })
    if (!schedule) throw new Error('Could not create schedule')
    await tx.insert(availabilityRules).values([1, 2, 3, 4, 5].map(weekday => ({
      scheduleId: schedule.id,
      weekday,
      startTime: '09:00:00',
      endTime: '17:00:00'
    })))
    return schedule
  })

  setResponseStatus(event, 201)
  return created
})
