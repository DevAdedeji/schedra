import { and, asc, count, eq, ilike, or } from 'drizzle-orm'
import { z } from 'zod'
import { paginationMeta, paginationQuerySchema } from '#shared/pagination'
import { eventTypes, schedules } from '../database/schema'
import { useDatabase } from '../utils/database'
import { ensureStarterSetup } from '../utils/onboarding'
import { requireAuthSession } from '../utils/session'

const querySchema = paginationQuerySchema.extend({
  filter: z.enum(['all', 'active', 'hidden']).default('all')
})

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const user = session.user as typeof session.user & { timeZone?: string }
  await ensureStarterSetup(session.user.id, user.timeZone || 'UTC')
  const parsed = await getValidatedQuery(event, querySchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid event type filters.' })

  const { page, pageSize, search, filter } = parsed.data
  const db = useDatabase()
  const mine = eq(eventTypes.userId, session.user.id)
  const visibility = filter === 'active'
    ? eq(eventTypes.hidden, false)
    : filter === 'hidden'
      ? eq(eventTypes.hidden, true)
      : undefined
  const matchesSearch = search
    ? or(
        ilike(eventTypes.title, `%${search}%`),
        ilike(eventTypes.slug, `%${search}%`),
        ilike(eventTypes.description, `%${search}%`)
      )
    : undefined
  const where = and(mine, visibility, matchesSearch)

  const [[totalRow], [allRow], [activeRow], [hiddenRow], items] = await Promise.all([
    db.select({ value: count() }).from(eventTypes).where(where),
    db.select({ value: count() }).from(eventTypes).where(mine),
    db.select({ value: count() }).from(eventTypes).where(and(mine, eq(eventTypes.hidden, false))),
    db.select({ value: count() }).from(eventTypes).where(and(mine, eq(eventTypes.hidden, true))),
    db.select({
      id: eventTypes.id,
      slug: eventTypes.slug,
      title: eventTypes.title,
      description: eventTypes.description,
      durationMinutes: eventTypes.durationMinutes,
      incrementMinutes: eventTypes.incrementMinutes,
      bufferBeforeMinutes: eventTypes.bufferBeforeMinutes,
      bufferAfterMinutes: eventTypes.bufferAfterMinutes,
      minimumNoticeMinutes: eventTypes.minimumNoticeMinutes,
      bookingWindowDays: eventTypes.bookingWindowDays,
      maxPerDay: eventTypes.maxPerDay,
      locationType: eventTypes.locationType,
      locationDetails: eventTypes.locationDetails,
      reminderMinutes: eventTypes.reminderMinutes,
      scheduleId: eventTypes.scheduleId,
      scheduleName: schedules.name,
      hidden: eventTypes.hidden
    }).from(eventTypes)
      .leftJoin(schedules, eq(schedules.id, eventTypes.scheduleId))
      .where(where)
      .orderBy(asc(eventTypes.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
  ])

  return {
    items,
    pagination: paginationMeta(totalRow?.value ?? 0, page, pageSize),
    counts: {
      all: allRow?.value ?? 0,
      active: activeRow?.value ?? 0,
      hidden: hiddenRow?.value ?? 0
    }
  }
})
