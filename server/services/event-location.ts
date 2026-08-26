import type { MeetingLocationType } from '#shared/validation'
import { writableGoogleCalendarUserIds } from '../repositories/calendar-connection'

export async function requireLocationIntegration(userId: string, locationType: MeetingLocationType) {
  if (locationType !== 'google_meet') return

  const connectedUserIds = await writableGoogleCalendarUserIds([userId])
  if (!connectedUserIds.length) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Connect Google Calendar and choose a calendar for new bookings before using Google Meet.'
    })
  }
}

/**
 * A Google Meet team event can assign any enabled host. Requiring every one of
 * those hosts to have a writable calendar prevents a booking succeeding but
 * later failing to create the host's meeting or calendar event.
 */
export async function requireTeamLocationIntegrations(
  userIds: string[],
  locationType: MeetingLocationType
) {
  if (locationType !== 'google_meet') return

  const uniqueUserIds = [...new Set(userIds)]
  const connectedUserIds = await writableGoogleCalendarUserIds(uniqueUserIds)

  if (connectedUserIds.length !== uniqueUserIds.length) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Every active host must connect Google Calendar and choose a calendar before this event can use Google Meet.'
    })
  }
}
