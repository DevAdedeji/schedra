import { and, asc, count, eq, ilike, inArray, sql } from 'drizzle-orm'
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

  const [[totalRow], [countRow], owned] = await Promise.all([
    db.select({ value: count() }).from(schedules).where(where),
    db.select({
      all: count(),
      default: sql<number>`count(*) filter (where ${schedules.isDefault} = true)`.mapWith(Number)
    }).from(schedules).where(mine),
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
          .where(inArray(availabilityRules.scheduleId, scheduleIds))
          .orderBy(asc(availabilityRules.weekday), asc(availabilityRules.startTime)),
        db.select({
          scheduleId: dateOverrides.scheduleId,
          date: dateOverrides.date,
          start: dateOverrides.startTime,
          end: dateOverrides.endTime
        }).from(dateOverrides)
          .where(inArray(dateOverrides.scheduleId, scheduleIds))
          .orderBy(asc(dateOverrides.date), asc(dateOverrides.startTime)),
        db.select({ scheduleId: eventTypes.scheduleId, value: count() }).from(eventTypes)
          .where(and(eq(eventTypes.userId, session.user.id), inArray(eventTypes.scheduleId, scheduleIds)))
          .groupBy(eventTypes.scheduleId)
      ])
    : [[], [], []]

  const items = owned.map(schedule => ({
    ...schedule,
    eventTypeCount: assignments.find(item => item.scheduleId === schedule.id)?.value ?? 0,
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
    counts: { all: countRow?.all ?? 0, default: countRow?.default ?? 0 }
  }
})
