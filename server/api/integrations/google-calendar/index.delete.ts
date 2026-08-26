import { disconnectGoogleCalendar } from '../../../integrations/calendar/google'
import { requireAuthSession } from '../../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  await disconnectGoogleCalendar(session.user.id)
  setResponseStatus(event, 204)
  return null
})
