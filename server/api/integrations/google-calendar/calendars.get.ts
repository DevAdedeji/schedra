import { CalendarUnavailableError, googleCalendarConnection, listGoogleCalendars } from '../../../utils/google-calendar'
import { requireAuthSession } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const connection = await googleCalendarConnection(session.user.id)
  if (!connection.connected) {
    throw createError({ statusCode: 409, statusMessage: 'Connect Google Calendar first.' })
  }

  try {
    return {
      items: await listGoogleCalendars(session.user.id),
      conflictCalendarIds: connection.conflictCalendarIds,
      writeCalendarId: connection.writeCalendarId
    }
  } catch (error) {
    if (error instanceof CalendarUnavailableError) {
      throw createError({ statusCode: 502, statusMessage: error.message })
    }
    throw error
  }
})
