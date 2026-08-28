import { paginationQuerySchema } from '#shared/pagination'
import { requireAuthSession } from '../../services/session'
import { listWorkflows } from '../../services/workflows'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const parsed = await getValidatedQuery(event, paginationQuerySchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid workflow filters.' })
  return listWorkflows({ userId: session.user.id }, parsed.data.page, parsed.data.pageSize)
})
