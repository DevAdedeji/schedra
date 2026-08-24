import { and, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { eventTypes } from '../../../database/schema'
import { useDatabase } from '../../../utils/database'
import { requireAuthSession } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 400, statusMessage: 'Invalid event type.' })

  const db = useDatabase()
  const [[source], [total], slugs] = await Promise.all([
    db.select().from(eventTypes)
      .where(and(eq(eventTypes.id, id.data), eq(eventTypes.userId, session.user.id))).limit(1),
    db.select({ value: count() }).from(eventTypes).where(eq(eventTypes.userId, session.user.id)),
    db.select({ slug: eventTypes.slug }).from(eventTypes).where(eq(eventTypes.userId, session.user.id))
  ])
  if (!source) throw createError({ statusCode: 404, statusMessage: 'No such event type.' })
  if ((total?.value ?? 0) >= 50) {
    throw createError({ statusCode: 409, statusMessage: 'You have reached the 50 event type limit.' })
  }

  const taken = new Set(slugs.map(row => row.slug.toLowerCase()))
  const base = `${source.slug}-copy`.slice(0, 64).replace(/-$/, '')
  let slug = base
  for (let suffix = 2; taken.has(slug); suffix++) {
    const ending = `-${suffix}`
    slug = `${base.slice(0, 64 - ending.length)}${ending}`
  }

  const [created] = await db.insert(eventTypes).values({
    userId: source.userId,
    organizationId: source.organizationId,
    scheduleId: source.scheduleId,
    slug,
    title: `${source.title} (copy)`.slice(0, 100),
    description: source.description,
    durationMinutes: source.durationMinutes,
    incrementMinutes: source.incrementMinutes,
    bufferBeforeMinutes: source.bufferBeforeMinutes,
    bufferAfterMinutes: source.bufferAfterMinutes,
    minimumNoticeMinutes: source.minimumNoticeMinutes,
    bookingWindowDays: source.bookingWindowDays,
    maxPerDay: source.maxPerDay,
    locationType: source.locationType,
    locationDetails: source.locationDetails,
    reminderMinutes: source.reminderMinutes,
    bookingQuestions: source.bookingQuestions,
    requiresConfirmation: source.requiresConfirmation,
    hidden: true
  }).returning({ id: eventTypes.id })

  if (!created) throw createError({ statusCode: 500, statusMessage: 'Could not duplicate this event type.' })
  setResponseStatus(event, 201)
  return created
})
