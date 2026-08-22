import { disconnectGoogleCalendar } from '../../../utils/google-calendar'
import { requireAuthSession } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  await disconnectGoogleCalendar(session.user.id)
  setResponseStatus(event, 204)
  return null
})
