import { and, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { availabilityRules, dateOverrides, schedules } from '../../../database/schema'
import { useDatabase } from '../../../utils/database'
import { requireAuthSession } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 400, statusMessage: 'Invalid schedule.' })

  const db = useDatabase()
  const [[source], [total]] = await Promise.all([
    db.select({ id: schedules.id, name: schedules.name, timeZone: schedules.timeZone })
      .from(schedules)
      .where(and(eq(schedules.id, id.data), eq(schedules.userId, session.user.id)))
      .limit(1),
    db.select({ value: count() }).from(schedules).where(eq(schedules.userId, session.user.id))
  ])

  if (!source) throw createError({ statusCode: 404, statusMessage: 'No such schedule.' })
  if ((total?.value ?? 0) >= 10) {
    throw createError({ statusCode: 409, statusMessage: 'You can create up to 10 schedules.' })
  }

  const [rules, overrides] = await Promise.all([
    db.select({ weekday: availabilityRules.weekday, startTime: availabilityRules.startTime, endTime: availabilityRules.endTime })
      .from(availabilityRules).where(eq(availabilityRules.scheduleId, source.id)),
    db.select({ date: dateOverrides.date, startTime: dateOverrides.startTime, endTime: dateOverrides.endTime })
      .from(dateOverrides).where(eq(dateOverrides.scheduleId, source.id))
  ])

  const created = await db.transaction(async (tx) => {
    const [schedule] = await tx.insert(schedules).values({
      userId: session.user.id,
      name: `${source.name} copy`.slice(0, 60),
      timeZone: source.timeZone,
      isDefault: false
    }).returning({ id: schedules.id })
    if (!schedule) throw new Error('Could not duplicate schedule')

    if (rules.length) {
      await tx.insert(availabilityRules).values(rules.map(rule => ({ scheduleId: schedule.id, ...rule })))
    }
    if (overrides.length) {
      await tx.insert(dateOverrides).values(overrides.map(override => ({ scheduleId: schedule.id, ...override })))
    }
    return schedule
  })

  setResponseStatus(event, 201)
  return created
})
