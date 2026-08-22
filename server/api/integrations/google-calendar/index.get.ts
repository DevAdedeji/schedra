import { googleCalendarConnection } from '../../../utils/google-calendar'
import { requireAuthSession } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  return googleCalendarConnection(session.user.id)
})
