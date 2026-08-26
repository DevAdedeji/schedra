import { googleCalendarConnection } from '../../../integrations/calendar/google'
import { requireAuthSession } from '../../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  return googleCalendarConnection(session.user.id)
})
