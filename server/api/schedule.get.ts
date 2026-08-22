import { and, asc, desc, eq, gte } from 'drizzle-orm'
import { availabilityRules, dateOverrides, schedules } from '../database/schema'
import { useDatabase } from '../utils/database'
import { requireAuthSession } from '../utils/session'
import { ensureStarterSetup } from '../utils/onboarding'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const user = session.user as typeof session.user & { timeZone?: string }

  await ensureStarterSetup(session.user.id, user.timeZone || 'UTC')

  const db = useDatabase()

  const [schedule] = await db
    .select({ id: schedules.id, name: schedules.name, timeZone: schedules.timeZone })
    .from(schedules)
    .where(eq(schedules.userId, session.user.id))
    .orderBy(desc(schedules.isDefault), asc(schedules.createdAt))
    .limit(1)

  if (!schedule) {
    throw createError({ statusCode: 404, statusMessage: 'No schedule' })
  }

  const today = new Date().toISOString().slice(0, 10)
  const [rules, overrides] = await Promise.all([
    db.select({
      weekday: availabilityRules.weekday,
      startTime: availabilityRules.startTime,
      endTime: availabilityRules.endTime
    }).from(availabilityRules)
      .where(eq(availabilityRules.scheduleId, schedule.id))
      .orderBy(asc(availabilityRules.weekday), asc(availabilityRules.startTime)),
    db.select({
      date: dateOverrides.date,
      startTime: dateOverrides.startTime,
      endTime: dateOverrides.endTime
    }).from(dateOverrides)
      .where(and(eq(dateOverrides.scheduleId, schedule.id), gte(dateOverrides.date, today)))
      .orderBy(asc(dateOverrides.date), asc(dateOverrides.startTime))
  ])

  return {
    name: schedule.name,
    timeZone: schedule.timeZone,
    rules: rules.map(rule => ({
      weekday: rule.weekday,
      start: rule.startTime.slice(0, 5),
      end: rule.endTime.slice(0, 5)
    })),
    overrides: overrides.map(override => ({
      date: override.date,
      start: override.startTime?.slice(0, 5) ?? null,
      end: override.endTime?.slice(0, 5) ?? null
    }))
  }
})
