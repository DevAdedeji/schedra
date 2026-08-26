import { and, count, desc, eq } from 'drizzle-orm'
import { eventTypeSchema } from '#shared/validation'
import { eventTypes, schedules } from '../database/schema'
import { useDatabase } from '../database/index'
import { ensureStarterSetup } from '../services/onboarding'
import { requireLocationIntegration } from '../services/event-location'
import { requireAuthSession } from '../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const user = session.user as typeof session.user & { timeZone?: string }
  await ensureStarterSetup(session.user.id, user.timeZone || 'UTC')
  const parsed = await readValidatedBody(event, eventTypeSchema.safeParse)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? 'Those event details are not valid.'
    })
  }

  const db = useDatabase()
  const { scheduleId: requestedScheduleId, ...input } = parsed.data
  const [[total], [schedule]] = await Promise.all([
    db.select({ value: count() }).from(eventTypes).where(eq(eventTypes.userId, session.user.id)),
    db.select({ id: schedules.id }).from(schedules)
      .where(requestedScheduleId
        ? and(eq(schedules.id, requestedScheduleId), eq(schedules.userId, session.user.id))
        : eq(schedules.userId, session.user.id))
      .orderBy(desc(schedules.isDefault), desc(schedules.createdAt))
      .limit(1)
  ])

  if ((total?.value ?? 0) >= 50) {
    throw createError({ statusCode: 409, statusMessage: 'You have reached the 50 event type limit.' })
  }
  if (!schedule) {
    throw createError({ statusCode: 409, statusMessage: 'Set your availability before creating an event type.' })
  }
  await requireLocationIntegration(session.user.id, input.locationType)

  try {
    const [created] = await db.insert(eventTypes).values({
      userId: session.user.id,
      scheduleId: schedule.id,
      ...input,
      description: input.description || null,
      incrementMinutes: input.incrementMinutes ?? null,
      bookingWindowDays: input.bookingWindowDays ?? null,
      maxPerDay: input.maxPerDay ?? null
    }).returning({ id: eventTypes.id })

    setResponseStatus(event, 201)
    return created
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw createError({ statusCode: 409, statusMessage: 'That booking-link slug is already in use.' })
    }
    throw error
  }
})
