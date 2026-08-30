import { z } from 'zod'
import {
  AppleCalendarSelectionError,
  AppleCalendarUnavailableError,
  updateAppleCalendarSelection
} from '../../../integrations/calendar/caldav'
import { logEvent } from '../../../observability/logger'
import { enqueueFutureBookingsForCalendarSync } from '../../../services/calendar-sync'
import { requireAuthSession } from '../../../services/session'

const selectionSchema = z.object({
  conflictCalendarIds: z.array(z.string().url().max(2048)).min(1, 'Choose at least one calendar.').max(20),
  writeCalendarId: z.string().url().max(2048),
  defaultForBookings: z.boolean().default(false)
}).refine(value => new Set(value.conflictCalendarIds).size === value.conflictCalendarIds.length, {
  message: 'Each conflict calendar may only be selected once.',
  path: ['conflictCalendarIds']
})

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const parsed = await readValidatedBody(event, selectionSchema.safeParse)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? 'Those Apple Calendar settings are not valid.'
    })
  }
  try {
    await updateAppleCalendarSelection(
      session.user.id,
      parsed.data.conflictCalendarIds,
      parsed.data.writeCalendarId,
      parsed.data.defaultForBookings
    )
  } catch (error) {
    if (error instanceof AppleCalendarSelectionError) {
      throw createError({ statusCode: 400, statusMessage: error.message })
    }
    if (error instanceof AppleCalendarUnavailableError) {
      throw createError({ statusCode: error.retryable ? 503 : 409, statusMessage: error.message })
    }
    throw error
  }

  try {
    await enqueueFutureBookingsForCalendarSync(session.user.id)
    return { ok: true, syncQueued: true }
  } catch (error) {
    logEvent('error', 'apple_calendar_booking_backfill_failed', {
      userId: session.user.id,
      error
    }, event)
    return { ok: true, syncQueued: false }
  }
})
