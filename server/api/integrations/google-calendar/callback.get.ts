import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import {
  exchangeGoogleCode,
  initializeGoogleCalendars,
  saveGoogleConnection
} from '../../../integrations/calendar/google'
import { enqueueFutureBookingsForCalendarSync } from '../../../services/calendar-sync'
import { requireAuthSession } from '../../../services/session'

const callbackQuery = z.object({
  code: z.string().min(1),
  state: z.string().min(32).max(128)
})

function matchesState(received: string, expected?: string) {
  if (!expected) return false
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const parsed = await getValidatedQuery(event, callbackQuery.safeParse)
  const expected = getCookie(event, 'schedra_google_calendar_state')
  deleteCookie(event, 'schedra_google_calendar_state', { path: '/api/integrations/google-calendar' })

  if (!parsed.success || !matchesState(parsed.data.state, expected)) {
    return sendRedirect(event, '/integrations?calendar=invalid-request')
  }

  try {
    const tokens = await exchangeGoogleCode(parsed.data.code)
    await saveGoogleConnection(session.user.id, tokens)
    await initializeGoogleCalendars(session.user.id)
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'google_calendar_connection_failed',
      userId: session.user.id,
      message: error instanceof Error ? error.message : String(error)
    }))
    return sendRedirect(event, '/integrations?calendar=connection-failed')
  }

  try {
    await enqueueFutureBookingsForCalendarSync(session.user.id)
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'google_calendar_booking_backfill_failed',
      userId: session.user.id,
      message: error instanceof Error ? error.message : String(error)
    }))
  }

  return sendRedirect(event, '/integrations?calendar=connected')
})
