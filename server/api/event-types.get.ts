import { and, asc, count, eq, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { paginationMeta, paginationQuerySchema } from '#shared/pagination'
import { eventTypes, schedules } from '../database/schema'
import { useDatabase } from '../database/index'
import { ensureStarterSetup } from '../services/onboarding'
import { requireAuthSession } from '../services/session'

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

  const [[totalRow], [countRow], items] = await Promise.all([
    db.select({ value: count() }).from(eventTypes).where(where),
    db.select({
      all: count(),
      active: sql<number>`count(*) filter (where ${eventTypes.hidden} = false)`.mapWith(Number),
      hidden: sql<number>`count(*) filter (where ${eventTypes.hidden} = true)`.mapWith(Number)
    }).from(eventTypes).where(mine),
    db.select({
      id: eventTypes.id,
      slug: eventTypes.slug,
      title: eventTypes.title,
      description: eventTypes.description,
      durationMinutes: eventTypes.durationMinutes,
      additionalDurationMinutes: eventTypes.additionalDurationMinutes,
      recurringBookingEnabled: eventTypes.recurringBookingEnabled,
      recurringBookingMaxOccurrences: eventTypes.recurringBookingMaxOccurrences,
      incrementMinutes: eventTypes.incrementMinutes,
      bufferBeforeMinutes: eventTypes.bufferBeforeMinutes,
      bufferAfterMinutes: eventTypes.bufferAfterMinutes,
      minimumNoticeMinutes: eventTypes.minimumNoticeMinutes,
      bookingWindowDays: eventTypes.bookingWindowDays,
      maxPerDay: eventTypes.maxPerDay,
      locationType: eventTypes.locationType,
      locationDetails: eventTypes.locationDetails,
      reminderMinutes: eventTypes.reminderMinutes,
      bookingQuestions: eventTypes.bookingQuestions,
      requiresConfirmation: eventTypes.requiresConfirmation,
      capacity: eventTypes.capacity,
      paymentEnabled: eventTypes.paymentEnabled,
      priceCents: eventTypes.priceCents,
      paymentCurrency: eventTypes.paymentCurrency,
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
      all: countRow?.all ?? 0,
      active: countRow?.active ?? 0,
      hidden: countRow?.hidden ?? 0
    }
  }
})
