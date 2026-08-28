import { z } from 'zod'
import { requirePlatformAdminSession } from '../../services/session'
import { retryOperation } from '../../services/operations'
import { logEvent } from '../../observability/logger'

const bodySchema = z.object({
  kind: z.enum(['automation', 'calendar', 'billing', 'email', 'webhook']),
  id: z.string().uuid()
})

export default defineEventHandler(async (event) => {
  const session = await requirePlatformAdminSession(event)
  const parsed = await readValidatedBody(event, bodySchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Choose a valid operation to retry.' })

  try {
    const retried = await retryOperation(parsed.data.kind, parsed.data.id)
    if (!retried) throw createError({ statusCode: 409, statusMessage: 'This operation no longer needs retrying.' })
    logEvent('info', 'operation_retried', {
      kind: parsed.data.kind,
      operationId: parsed.data.id,
      actorId: session.user.id
    }, event)
    return { retried: true }
  } catch (error) {
    if (isError(error)) throw error
    logEvent('error', 'operation_retry_failed', {
      kind: parsed.data.kind,
      operationId: parsed.data.id,
      actorId: session.user.id,
      error
    }, event)
    throw createError({ statusCode: 503, statusMessage: 'The operation could not be retried.' })
  }
})
