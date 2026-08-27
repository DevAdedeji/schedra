import {
  listMicrosoftCalendars,
  microsoftCalendarConnection,
  MicrosoftCalendarUnavailableError
} from '../../../integrations/calendar/microsoft'
import { requireAuthSession } from '../../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const connection = await microsoftCalendarConnection(session.user.id)
  if (!connection.connected) {
    throw createError({ statusCode: 409, statusMessage: 'Connect Microsoft Calendar first.' })
  }

  try {
    return {
      items: await listMicrosoftCalendars(session.user.id),
      conflictCalendarIds: connection.conflictCalendarIds,
      writeCalendarId: connection.writeCalendarId
    }
  } catch (error) {
    if (error instanceof MicrosoftCalendarUnavailableError) {
      throw createError({ statusCode: 502, statusMessage: error.message })
    }
    throw error
  }
})
