import { microsoftCalendarConnection } from '../../../integrations/calendar/microsoft'
import { requireAuthSession } from '../../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  return microsoftCalendarConnection(session.user.id)
})
