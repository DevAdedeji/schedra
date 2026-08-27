import { z } from 'zod'
import {
  exchangeGoogleCode,
  initializeGoogleCalendars,
  saveGoogleConnection
} from '../../../integrations/calendar/google'
import { enqueueFutureBookingsForCalendarSync } from '../../../services/calendar-sync'
import { requireAuthSession } from '../../../services/session'
import { matchesOAuthState } from '../../../security/oauth'
import { logEvent } from '../../../observability/logger'

const callbackQuery = z.object({
  code: z.string().min(1),
  state: z.string().min(32).max(128)
})

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const parsed = await getValidatedQuery(event, callbackQuery.safeParse)
  const expected = getCookie(event, 'schedra_google_calendar_state')
  const codeVerifier = getCookie(event, 'schedra_google_calendar_pkce')
  deleteCookie(event, 'schedra_google_calendar_state', { path: '/api/integrations/google-calendar' })
  deleteCookie(event, 'schedra_google_calendar_pkce', { path: '/api/integrations/google-calendar' })

  if (!parsed.success || !codeVerifier || !matchesOAuthState(parsed.data.state, expected)) {
    return sendRedirect(event, '/integrations?calendar=invalid-request')
  }

  try {
    const tokens = await exchangeGoogleCode(parsed.data.code, codeVerifier)
    await saveGoogleConnection(session.user.id, tokens)
    await initializeGoogleCalendars(session.user.id)
  } catch (error) {
    logEvent('error', 'google_calendar_connection_failed', {
      userId: session.user.id,
      error
    }, event)
    return sendRedirect(event, '/integrations?calendar=connection-failed')
  }

  try {
    await enqueueFutureBookingsForCalendarSync(session.user.id)
  } catch (error) {
    logEvent('error', 'google_calendar_booking_backfill_failed', {
      userId: session.user.id,
      error
    }, event)
  }

  return sendRedirect(event, '/integrations?calendar=connected')
})
