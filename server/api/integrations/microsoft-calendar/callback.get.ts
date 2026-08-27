import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import {
  exchangeMicrosoftCode,
  initializeMicrosoftCalendars,
  saveMicrosoftConnection
} from '../../../integrations/calendar/microsoft'
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
  const expected = getCookie(event, 'schedra_microsoft_calendar_state')
  deleteCookie(event, 'schedra_microsoft_calendar_state', {
    path: '/api/integrations/microsoft-calendar'
  })

  if (!parsed.success || !matchesState(parsed.data.state, expected)) {
    return sendRedirect(event, '/integrations?microsoft=invalid-request')
  }

  try {
    const tokens = await exchangeMicrosoftCode(parsed.data.code)
    await saveMicrosoftConnection(session.user.id, tokens)
    await initializeMicrosoftCalendars(session.user.id)
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'microsoft_calendar_connection_failed',
      userId: session.user.id,
      message: error instanceof Error ? error.message : String(error)
    }))
    return sendRedirect(event, '/integrations?microsoft=connection-failed')
  }

  try {
    await enqueueFutureBookingsForCalendarSync(session.user.id)
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'microsoft_calendar_booking_backfill_failed',
      userId: session.user.id,
      message: error instanceof Error ? error.message : String(error)
    }))
  }

  return sendRedirect(event, '/integrations?microsoft=connected')
})
