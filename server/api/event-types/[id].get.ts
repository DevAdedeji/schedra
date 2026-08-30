import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { eventTypes, schedules } from '../../database/schema'
import { useDatabase } from '../../database/index'
import { requireAuthSession } from '../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))

  if (!id.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid event type.' })
  }

  const [found] = await useDatabase()
    .select({
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
      maxPerWeek: eventTypes.maxPerWeek,
      maxPerMonth: eventTypes.maxPerMonth,
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
    })
    .from(eventTypes)
    .leftJoin(schedules, eq(schedules.id, eventTypes.scheduleId))
    .where(and(eq(eventTypes.id, id.data), eq(eventTypes.userId, session.user.id)))
    .limit(1)

  if (!found) {
    throw createError({ statusCode: 404, statusMessage: 'No such event type.' })
  }

  return found
})
