import { appleCalendarConnection } from '../../../integrations/calendar/caldav'
import { requireAuthSession } from '../../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  return appleCalendarConnection(session.user.id)
})
