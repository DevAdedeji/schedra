import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { exchangeZoomCode, saveZoomConnection } from '../../../integrations/video/zoom'
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
  const expected = getCookie(event, 'schedra_zoom_state')
  deleteCookie(event, 'schedra_zoom_state', { path: '/api/integrations/zoom' })

  if (!parsed.success || !matchesState(parsed.data.state, expected)) {
    return sendRedirect(event, '/integrations?zoom=invalid-request')
  }

  try {
    const tokens = await exchangeZoomCode(parsed.data.code)
    await saveZoomConnection(session.user.id, tokens)
    await enqueueFutureBookingsForCalendarSync(session.user.id)
    return sendRedirect(event, '/integrations?zoom=connected')
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'zoom_connection_failed',
      userId: session.user.id,
      message: error instanceof Error ? error.message : String(error)
    }))
    return sendRedirect(event, '/integrations?zoom=connection-failed')
  }
})
