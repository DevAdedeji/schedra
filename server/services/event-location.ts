import type { MeetingLocationType } from '#shared/validation'
import { writableGoogleCalendarUserIds, writableMicrosoftTeamsCalendarUserIds } from '../repositories/calendar-connection'
import { connectedZoomUserIds } from '../repositories/video-conference-connection'

export async function locationIntegrationReady(userId: string, locationType: MeetingLocationType) {
  if (!['google_meet', 'microsoft_teams', 'zoom'].includes(locationType)) return true

  const connectedUserIds = locationType === 'google_meet'
    ? await writableGoogleCalendarUserIds([userId])
    : locationType === 'microsoft_teams'
      ? await writableMicrosoftTeamsCalendarUserIds([userId])
      : await connectedZoomUserIds([userId])
  return connectedUserIds.length > 0
}

export async function requireLocationIntegration(userId: string, locationType: MeetingLocationType) {
  if (!await locationIntegrationReady(userId, locationType)) {
    throw createError({
      statusCode: 409,
      statusMessage: locationType === 'google_meet'
        ? 'Connect Google Calendar and choose a writable calendar before using Google Meet.'
        : locationType === 'microsoft_teams'
          ? 'Connect Microsoft Calendar and choose a writable calendar that supports Teams first.'
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
        ? 'Every active host must connect Google Calendar and choose a writable calendar before this event can use Google Meet.'
        : locationType === 'microsoft_teams'
          ? 'Every active host must connect Microsoft Calendar and choose a writable calendar that supports Teams.'
          : 'Every active host must connect Zoom before this team event can use Zoom.'
    })
  }
}
