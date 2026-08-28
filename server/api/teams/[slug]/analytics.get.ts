import { analyticsQuerySchema } from '#shared/analytics'
import { organizationAccessRoles } from '#shared/organization-access'
import { getBookingAnalytics } from '../../../services/analytics'
import { requireOrganization } from '../../../services/organization'

export default defineEventHandler(async (event) => {
  const context = await requireOrganization(event, getRouterParam(event, 'slug') ?? '')
  const parsed = await getValidatedQuery(event, analyticsQuerySchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Choose a valid analytics range.' })
  const seesEverything = organizationAccessRoles[context.role].authorize({ booking: ['viewAll'] }).success
  return getBookingAnalytics({
    organizationId: context.organization.id,
    visibleUserId: seesEverything ? undefined : context.userId
  }, parsed.data)
})
