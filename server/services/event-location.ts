import type { MeetingLocationType } from '#shared/validation'
import { writableGoogleCalendarUserIds } from '../repositories/calendar-connection'
import { connectedZoomUserIds } from '../repositories/video-conference-connection'

export async function requireLocationIntegration(userId: string, locationType: MeetingLocationType) {
  if (!['google_meet', 'zoom'].includes(locationType)) return

  const connectedUserIds = locationType === 'google_meet'
    ? await writableGoogleCalendarUserIds([userId])
    : await connectedZoomUserIds([userId])
  if (!connectedUserIds.length) {
    throw createError({
      statusCode: 409,
      statusMessage: locationType === 'google_meet'
        ? 'Connect Google Calendar and choose a calendar for new bookings before using Google Meet.'
        : 'Connect Zoom before using Zoom as the meeting location.'
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
  if (!['google_meet', 'zoom'].includes(locationType)) return

  const uniqueUserIds = [...new Set(userIds)]
  const connectedUserIds = locationType === 'google_meet'
    ? await writableGoogleCalendarUserIds(uniqueUserIds)
    : await connectedZoomUserIds(uniqueUserIds)

  if (connectedUserIds.length !== uniqueUserIds.length) {
    throw createError({
      statusCode: 409,
      statusMessage: locationType === 'google_meet'
        ? 'Every active host must connect Google Calendar and choose a calendar before this event can use Google Meet.'
        : 'Every active host must connect Zoom before this team event can use Zoom.'
    })
  }
}
