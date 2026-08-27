import { z } from 'zod'
import {
  exchangeMicrosoftCode,
  initializeMicrosoftCalendars,
  saveMicrosoftConnection
} from '../../../integrations/calendar/microsoft'
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
  const expected = getCookie(event, 'schedra_microsoft_calendar_state')
  const codeVerifier = getCookie(event, 'schedra_microsoft_calendar_pkce')
  deleteCookie(event, 'schedra_microsoft_calendar_state', {
    path: '/api/integrations/microsoft-calendar'
  })
  deleteCookie(event, 'schedra_microsoft_calendar_pkce', {
    path: '/api/integrations/microsoft-calendar'
  })

  if (!parsed.success || !codeVerifier || !matchesOAuthState(parsed.data.state, expected)) {
    return sendRedirect(event, '/integrations?microsoft=invalid-request')
  }

  let connectionSaved = false
  try {
    const tokens = await exchangeMicrosoftCode(parsed.data.code, codeVerifier)
    await saveMicrosoftConnection(session.user.id, tokens)
    connectionSaved = true
    await initializeMicrosoftCalendars(session.user.id)
  } catch (error) {
    logEvent('error', 'microsoft_calendar_connection_failed', {
      userId: session.user.id,
      error
    }, event)
    return sendRedirect(event, connectionSaved
      ? '/integrations?microsoft=setup-incomplete'
      : '/integrations?microsoft=connection-failed')
  }

  try {
    await enqueueFutureBookingsForCalendarSync(session.user.id)
  } catch (error) {
    logEvent('error', 'microsoft_calendar_booking_backfill_failed', {
      userId: session.user.id,
      error
    }, event)
  }

  return sendRedirect(event, '/integrations?microsoft=connected')
})
