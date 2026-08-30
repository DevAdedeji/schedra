import {
  AppleCalendarUnavailableError,
  appleCalendarConnection,
  listAppleCalendars
} from '../../../integrations/calendar/caldav'
import { requireAuthSession } from '../../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const connection = await appleCalendarConnection(session.user.id)
  if (!connection.connected) {
    throw createError({ statusCode: 409, statusMessage: 'Connect Apple Calendar first.' })
  }
  try {
    return {
      items: await listAppleCalendars(session.user.id),
      conflictCalendarIds: connection.conflictCalendarIds,
      writeCalendarId: connection.writeCalendarId
    }
  } catch (error) {
    if (error instanceof AppleCalendarUnavailableError) {
      throw createError({ statusCode: error.retryable ? 503 : 409, statusMessage: error.message })
    }
    throw error
  }
})
