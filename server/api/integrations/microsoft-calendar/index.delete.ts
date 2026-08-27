import { disconnectMicrosoftCalendar } from '../../../integrations/calendar/microsoft'
import { requireAuthSession } from '../../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  await disconnectMicrosoftCalendar(session.user.id)
  setResponseStatus(event, 204)
  return null
})
