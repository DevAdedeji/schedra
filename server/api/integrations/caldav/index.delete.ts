import { disconnectAppleCalendar } from '../../../integrations/calendar/caldav'
import { requireAuthSession } from '../../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  await disconnectAppleCalendar(session.user.id)
  setResponseStatus(event, 204)
  return null
})
