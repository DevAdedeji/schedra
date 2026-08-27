import type { MeetingLocationType } from '#shared/validation'
import { writableGoogleCalendarUserIds, writableMicrosoftTeamsCalendarUserIds } from '../repositories/calendar-connection'
import { connectedZoomUserIds } from '../repositories/video-conference-connection'

export async function requireLocationIntegration(userId: string, locationType: MeetingLocationType) {
  if (!['google_meet', 'microsoft_teams', 'zoom'].includes(locationType)) return

  const connectedUserIds = locationType === 'google_meet'
    ? await writableGoogleCalendarUserIds([userId])
    : locationType === 'microsoft_teams'
      ? await writableMicrosoftTeamsCalendarUserIds([userId])
      : await connectedZoomUserIds([userId])
  if (!connectedUserIds.length) {
    throw createError({
      statusCode: 409,
      statusMessage: locationType === 'google_meet'
        ? 'Connect Google Calendar and choose it for new bookings before using Google Meet.'
        : locationType === 'microsoft_teams'
          ? 'Connect a Microsoft calendar that supports Teams and choose it for new bookings first.'
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
  if (!['google_meet', 'microsoft_teams', 'zoom'].includes(locationType)) return

  const uniqueUserIds = [...new Set(userIds)]
  const connectedUserIds = locationType === 'google_meet'
    ? await writableGoogleCalendarUserIds(uniqueUserIds)
    : locationType === 'microsoft_teams'
      ? await writableMicrosoftTeamsCalendarUserIds(uniqueUserIds)
      : await connectedZoomUserIds(uniqueUserIds)

  if (connectedUserIds.length !== uniqueUserIds.length) {
    throw createError({
      statusCode: 409,
      statusMessage: locationType === 'google_meet'
        ? 'Every active host must connect Google Calendar and choose it for new bookings before this event can use Google Meet.'
        : locationType === 'microsoft_teams'
          ? 'Every active host must connect a Microsoft calendar that supports Teams and choose it for new bookings.'
          : 'Every active host must connect Zoom before this team event can use Zoom.'
    })
  }
}
