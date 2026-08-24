import type { MeetingLocationType } from '#shared/validation'
import { googleConnectionFor } from './google-calendar'

export async function requireLocationIntegration(userId: string, locationType: MeetingLocationType) {
  if (locationType !== 'google_meet') return

  const connection = await googleConnectionFor(userId)
  if (!connection || connection.status !== 'active' || !connection.writeCalendarId) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Connect Google Calendar and choose a calendar for new bookings before using Google Meet.'
    })
  }
}
