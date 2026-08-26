import { asc, desc, eq, sql } from 'drizzle-orm'
import { scheduleSchema } from '#shared/validation'
import { availabilityRules, dateOverrides, schedules } from '../database/schema'
import { useDatabase } from '../database/index'
import { requireAuthSession } from '../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const parsed = await readValidatedBody(event, scheduleSchema.safeParse)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? 'Those hours are not valid.'
    })
  }

  const db = useDatabase()

  const [schedule] = await db
    .select({ id: schedules.id })
    .from(schedules)
    .where(eq(schedules.userId, session.user.id))
    .orderBy(desc(schedules.isDefault), asc(schedules.createdAt))
    .limit(1)

  if (!schedule) {
    throw createError({ statusCode: 404, statusMessage: 'No schedule' })
  }

  const { timeZone, rules, overrides } = parsed.data

  await db.transaction(async (tx) => {
    await tx.update(schedules)
      .set({ timeZone, updatedAt: sql`now()` })
      .where(eq(schedules.id, schedule.id))

    await tx.delete(availabilityRules).where(eq(availabilityRules.scheduleId, schedule.id))

    if (rules.length) {
      await tx.insert(availabilityRules).values(rules.map(rule => ({
        scheduleId: schedule.id,
        weekday: rule.weekday,
        startTime: `${rule.start}:00`,
        endTime: `${rule.end}:00`
      })))
    }

    if (overrides) {
      await tx.delete(dateOverrides).where(eq(dateOverrides.scheduleId, schedule.id))
      if (overrides.length) {
        await tx.insert(dateOverrides).values(overrides.map(override => ({
          scheduleId: schedule.id,
          date: override.date,
          startTime: override.start ? `${override.start}:00` : null,
          endTime: override.end ? `${override.end}:00` : null
        })))
      }
    }
  })

  return { ok: true }
})
