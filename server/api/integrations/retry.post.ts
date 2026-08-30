import { z } from 'zod'
import { retryFailedIntegrationSyncs } from '../../services/integration-health'
import { requireAuthSession } from '../../services/session'

const retrySchema = z.object({
  provider: z.enum(['google', 'microsoft', 'caldav', 'zoom']).optional()
}).default({})

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const parsed = await readValidatedBody(event, retrySchema.safeParse)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Choose a supported integration to retry.' })
  }
  const retried = await retryFailedIntegrationSyncs(session.user.id, parsed.data.provider)
  return { retried }
})
