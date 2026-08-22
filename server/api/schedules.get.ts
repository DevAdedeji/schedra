import { and, asc, count, eq, ilike } from 'drizzle-orm'
import { z } from 'zod'
import { paginationMeta, paginationQuerySchema } from '#shared/pagination'
import { availabilityRules, dateOverrides, eventTypes, schedules } from '../database/schema'
import { useDatabase } from '../utils/database'
import { ensureStarterSetup } from '../utils/onboarding'
import { requireAuthSession } from '../utils/session'

const querySchema = paginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(10).default(10),
  filter: z.enum(['all', 'default']).default('all')
})

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const user = session.user as typeof session.user & { timeZone?: string }
  await ensureStarterSetup(session.user.id, user.timeZone || 'UTC')
  const parsed = await getValidatedQuery(event, querySchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid schedule filters.' })

  const { page, pageSize, search, filter } = parsed.data
  const db = useDatabase()
  const mine = eq(schedules.userId, session.user.id)
  const where = and(
    mine,
    filter === 'default' ? eq(schedules.isDefault, true) : undefined,
    search ? ilike(schedules.name, `%${search}%`) : undefined
  )

  const [[totalRow], [allRow], [defaultRow], owned] = await Promise.all([
    db.select({ value: count() }).from(schedules).where(where),
    db.select({ value: count() }).from(schedules).where(mine),
    db.select({ value: count() }).from(schedules).where(and(mine, eq(schedules.isDefault, true))),
    db.select({
      id: schedules.id,
      name: schedules.name,
      timeZone: schedules.timeZone,
      isDefault: schedules.isDefault
    }).from(schedules)
      .where(where)
      .orderBy(asc(schedules.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
  ])

  const scheduleIds = owned.map(schedule => schedule.id)
  const [rules, overrides, assignments] = scheduleIds.length
    ? await Promise.all([
        db.select({
          scheduleId: availabilityRules.scheduleId,
          weekday: availabilityRules.weekday,
          start: availabilityRules.startTime,
          end: availabilityRules.endTime
        }).from(availabilityRules)
          .innerJoin(schedules, eq(schedules.id, availabilityRules.scheduleId))
          .where(eq(schedules.userId, session.user.id))
          .orderBy(asc(availabilityRules.weekday), asc(availabilityRules.startTime)),
        db.select({
          scheduleId: dateOverrides.scheduleId,
          date: dateOverrides.date,
          start: dateOverrides.startTime,
          end: dateOverrides.endTime
        }).from(dateOverrides)
          .innerJoin(schedules, eq(schedules.id, dateOverrides.scheduleId))
          .where(eq(schedules.userId, session.user.id))
          .orderBy(asc(dateOverrides.date), asc(dateOverrides.startTime)),
        db.select({ scheduleId: eventTypes.scheduleId }).from(eventTypes)
          .where(eq(eventTypes.userId, session.user.id))
      ])
    : [[], [], []]

  const items = owned.map(schedule => ({
    ...schedule,
    eventTypeCount: assignments.filter(item => item.scheduleId === schedule.id).length,
    rules: rules.filter(rule => rule.scheduleId === schedule.id).map(rule => ({
      weekday: rule.weekday,
      start: rule.start.slice(0, 5),
      end: rule.end.slice(0, 5)
    })),
    overrides: overrides.filter(override => override.scheduleId === schedule.id).map(override => ({
      date: override.date,
      start: override.start?.slice(0, 5) ?? null,
      end: override.end?.slice(0, 5) ?? null
    }))
  }))

  return {
    items,
    pagination: paginationMeta(totalRow?.value ?? 0, page, pageSize),
    counts: { all: allRow?.value ?? 0, default: defaultRow?.value ?? 0 }
  }
})
