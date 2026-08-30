import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { eventTypeSchema } from '#shared/validation'
import { eventTypes, schedules } from '../../database/schema'
import { useDatabase } from '../../database/index'
import { requireAuthSession } from '../../services/session'
import { requireLocationIntegration } from '../../services/event-location'
import { requirePaymentRecipient } from '../../services/paid-booking'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  const parsed = await readValidatedBody(event, eventTypeSchema.safeParse)

  if (!id.success || !parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.success
        ? 'Missing event type'
        : parsed.error.issues[0]?.message ?? 'Those event details are not valid.'
    })
  }

  const db = useDatabase()
  if (parsed.data.scheduleId) {
    const [schedule] = await db.select({ id: schedules.id }).from(schedules)
      .where(and(eq(schedules.id, parsed.data.scheduleId), eq(schedules.userId, session.user.id))).limit(1)
    if (!schedule) throw createError({ statusCode: 400, statusMessage: 'Choose one of your availability schedules.' })
  }
  await requireLocationIntegration(session.user.id, parsed.data.locationType)
  await requirePaymentRecipient({ userId: session.user.id }, parsed.data.paymentEnabled)

  try {
    const [updated] = await db
      .update(eventTypes)
      .set({
        ...parsed.data,
        description: parsed.data.description || null,
        incrementMinutes: parsed.data.incrementMinutes ?? null,
        bookingWindowDays: parsed.data.bookingWindowDays ?? null,
        maxPerDay: parsed.data.maxPerDay ?? null,
        maxPerWeek: parsed.data.maxPerWeek ?? null,
        maxPerMonth: parsed.data.maxPerMonth ?? null,
        updatedAt: sql`now()`
      })
      .where(and(eq(eventTypes.id, id.data), eq(eventTypes.userId, session.user.id)))
      .returning({ id: eventTypes.id })

    if (!updated) {
      throw createError({ statusCode: 404, statusMessage: 'No such event type.' })
    }

    return updated
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw createError({ statusCode: 409, statusMessage: 'That booking-link slug is already in use.' })
    }
    throw error
  }
})
