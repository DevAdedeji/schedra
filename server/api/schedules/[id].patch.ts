import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { savedScheduleSchema } from '#shared/validation'
import { availabilityRules, dateOverrides, schedules } from '../../database/schema'
import { useDatabase } from '../../database/index'
import { requireAuthSession } from '../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  const parsed = await readValidatedBody(event, savedScheduleSchema.safeParse)
  if (!id.success || !parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.success ? 'Invalid schedule.' : parsed.error.issues[0]?.message })
  }

  const db = useDatabase()
  const [owned] = await db.select({ id: schedules.id }).from(schedules)
    .where(and(eq(schedules.id, id.data), eq(schedules.userId, session.user.id))).limit(1)
  if (!owned) throw createError({ statusCode: 404, statusMessage: 'No such schedule.' })

  const { name, timeZone, rules, overrides = [], isDefault } = parsed.data
  await db.transaction(async (tx) => {
    if (isDefault) {
      await tx.update(schedules).set({ isDefault: false }).where(eq(schedules.userId, session.user.id))
    }
    await tx.update(schedules).set({
      name,
      timeZone,
      ...(isDefault ? { isDefault: true } : {}),
      updatedAt: sql`now()`
    })
      .where(and(eq(schedules.id, id.data), eq(schedules.userId, session.user.id)))
    await tx.delete(availabilityRules).where(eq(availabilityRules.scheduleId, id.data))
    if (rules.length) {
      await tx.insert(availabilityRules).values(rules.map(rule => ({
        scheduleId: id.data,
        weekday: rule.weekday,
        startTime: `${rule.start}:00`,
        endTime: `${rule.end}:00`
      })))
    }
    await tx.delete(dateOverrides).where(eq(dateOverrides.scheduleId, id.data))
    if (overrides.length) {
      await tx.insert(dateOverrides).values(overrides.map(override => ({
        scheduleId: id.data,
        date: override.date,
        startTime: override.start ? `${override.start}:00` : null,
        endTime: override.end ? `${override.end}:00` : null
      })))
    }
  })
  return { id: id.data }
})
