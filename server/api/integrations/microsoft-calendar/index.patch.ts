import { z } from 'zod'
import {
  MicrosoftCalendarSelectionError,
  MicrosoftCalendarUnavailableError,
  updateMicrosoftCalendarSelection
} from '../../../integrations/calendar/microsoft'
import { enqueueFutureBookingsForCalendarSync } from '../../../services/calendar-sync'
import { requireAuthSession } from '../../../services/session'
import { logEvent } from '../../../observability/logger'

const selectionSchema = z.object({
  conflictCalendarIds: z.array(z.string().min(1).max(1024)).min(1, 'Choose at least one calendar.').max(20),
  writeCalendarId: z.string().min(1).max(1024).nullable()
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
      statusMessage: parsed.error.issues[0]?.message ?? 'Those Microsoft calendar settings are not valid.'
    })
  }

  try {
    await updateMicrosoftCalendarSelection(
      session.user.id,
      parsed.data.conflictCalendarIds,
      parsed.data.writeCalendarId
    )
  } catch (error) {
    if (error instanceof MicrosoftCalendarSelectionError) {
      throw createError({ statusCode: 400, statusMessage: error.message })
    }
    if (error instanceof MicrosoftCalendarUnavailableError) {
      throw createError({ statusCode: 502, statusMessage: error.message })
    }
    throw error
  }

  try {
    await enqueueFutureBookingsForCalendarSync(session.user.id)
    return { ok: true, syncQueued: true }
  } catch (error) {
    logEvent('error', 'microsoft_calendar_booking_backfill_failed', {
      userId: session.user.id,
      error
    }, event)
    return { ok: true, syncQueued: false }
  }
})
