import { z } from 'zod'
import {
  AppleCalendarUnavailableError,
  appleCalendarConnection,
  connectAppleCalendar
} from '../../../integrations/calendar/caldav'
import { logEvent } from '../../../observability/logger'
import { enqueueFutureBookingsForCalendarSync } from '../../../services/calendar-sync'
import { enforceRateLimit } from '../../../services/rate-limit'
import { requireAuthSession } from '../../../services/session'

const credentialsSchema = z.object({
  username: z.string().trim().email('Enter the email address used by your Apple Account.').max(320),
  password: z.string().trim().min(10, 'Enter an Apple app-specific password.').max(128)
})

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  await enforceRateLimit(event, {
    namespace: 'apple-calendar-connect',
    limit: 5,
    windowSeconds: 15 * 60,
    identity: session.user.id
  })
  const parsed = await readValidatedBody(event, credentialsSchema.safeParse)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? 'Those Apple Calendar credentials are not valid.'
    })
  }

  try {
    await connectAppleCalendar(session.user.id, parsed.data)
  } catch (error) {
    if (error instanceof AppleCalendarUnavailableError) {
      throw createError({
        statusCode: error.retryable ? 503 : 400,
        statusMessage: error.message
      })
    }
    throw error
  }

  try {
    await enqueueFutureBookingsForCalendarSync(session.user.id)
  } catch (error) {
    logEvent('error', 'apple_calendar_booking_backfill_failed', {
      userId: session.user.id,
      error
    }, event)
  }
  return appleCalendarConnection(session.user.id)
})
