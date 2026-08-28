import { z } from 'zod'
import { paginationQuerySchema } from '#shared/pagination'
import { requirePlatformAdminSession } from '../../services/session'
import { operationsJobs } from '../../services/operations'

const querySchema = paginationQuerySchema.pick({ page: true, pageSize: true }).extend({
  kind: z.enum(['automation', 'calendar', 'billing', 'email', 'webhook']).default('calendar'),
  status: z.enum(['all', 'pending', 'processing', 'completed', 'failed', 'ignored']).default('all')
})

export default defineEventHandler(async (event) => {
  await requirePlatformAdminSession(event)
  const parsed = await getValidatedQuery(event, querySchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid operations filters.' })
  return operationsJobs(parsed.data)
})
