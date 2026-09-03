import { paginationQuerySchema } from '#shared/pagination'
import { requirePlatformAdminSession } from '../../services/session'
import { controlOrganizations } from '../../services/control'

export default defineEventHandler(async (event) => {
  await requirePlatformAdminSession(event)
  const parsed = await getValidatedQuery(event, paginationQuerySchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid team filters.' })
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  return controlOrganizations(parsed.data)
})
