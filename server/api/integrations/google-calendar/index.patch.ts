import { z } from 'zod'
import { CalendarSelectionError, CalendarUnavailableError, updateGoogleCalendarSelection } from '../../../integrations/calendar/google'
import { enqueueFutureBookingsForCalendarSync } from '../../../services/calendar-sync'
import { requireAuthSession } from '../../../services/session'

const selectionSchema = z.object({
  conflictCalendarIds: z.array(z.string().min(1).max(1024)).min(1, 'Choose at least one calendar.').max(50),
  writeCalendarId: z.string().min(1).max(1024)
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
      statusMessage: parsed.error.issues[0]?.message ?? 'Those calendar settings are not valid.'
    })
  }

  try {
    await updateGoogleCalendarSelection(
      session.user.id,
      parsed.data.conflictCalendarIds,
      parsed.data.writeCalendarId
    )
  } catch (error) {
    if (error instanceof CalendarSelectionError) {
      throw createError({ statusCode: 400, statusMessage: error.message })
    }
    if (error instanceof CalendarUnavailableError) {
      throw createError({ statusCode: 502, statusMessage: error.message })
    }
    throw error
  }

  try {
    await enqueueFutureBookingsForCalendarSync(session.user.id)
    return { ok: true, syncQueued: true }
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'google_calendar_booking_backfill_failed',
      userId: session.user.id,
      message: error instanceof Error ? error.message : String(error)
    }))
    return { ok: true, syncQueued: false }
  }
})
