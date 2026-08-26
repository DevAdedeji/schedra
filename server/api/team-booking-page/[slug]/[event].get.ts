import { activeHostsFor, findPublicTeamEventType } from '../../../services/team-booking'
import { enforceRateLimit } from '../../../services/rate-limit'

export default defineEventHandler(async (request) => {
  await enforceRateLimit(request, { namespace: 'team-booking-page', limit: 120, windowSeconds: 60 })

  const slug = getRouterParam(request, 'slug') ?? ''
  const eventSlug = getRouterParam(request, 'event') ?? ''

  const eventType = await findPublicTeamEventType(slug, eventSlug)
  if (!eventType) throw createError({ statusCode: 404, statusMessage: 'No such booking page' })

  const hosts = await activeHostsFor(eventType.id)
  if (!hosts.length) {
    // An event with nobody able to host is unbookable; saying so is kinder than
    // showing a calendar with no times in it.
    throw createError({ statusCode: 409, statusMessage: 'This team event has no available hosts right now.' })
  }

  return {
    // Named `hostName` so the team page and the personal one share one shape,
    // and therefore one booking component.
    hostName: eventType.assignmentMode === 'collective'
      ? `${eventType.organizationName} — ${hosts.map(host => host.name).join(', ')}`
      : eventType.organizationName,
    teamName: eventType.organizationName,
    teamSlug: eventType.organizationSlug,
    title: eventType.title,
    description: eventType.description,
    durationMinutes: eventType.durationMinutes,
    assignmentMode: eventType.assignmentMode,
    locationType: eventType.locationType,
    locationDetails: eventType.locationDetails,
    bookingQuestions: eventType.bookingQuestions,
    requiresConfirmation: eventType.requiresConfirmation,
    hosts: hosts.map(host => ({ name: host.name, avatarUrl: host.avatarUrl }))
  }
})
