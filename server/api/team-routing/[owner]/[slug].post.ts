import { routingSubmissionSchema } from '#shared/routing'
import { enforceRateLimit } from '../../../services/rate-limit'
import { findPublicRoutingForm, submitRoutingForm } from '../../../services/routing-forms'

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, { namespace: 'team-routing-submit', limit: 20, windowSeconds: 600 })
  const parsed = await readValidatedBody(event, routingSubmissionSchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Check your answers.' })
  const form = await findPublicRoutingForm(getRouterParam(event, 'owner') ?? '', getRouterParam(event, 'slug') ?? '', true)
  if (!form) throw createError({ statusCode: 404, statusMessage: 'Routing form not found.' })
  return submitRoutingForm(form, parsed.data)
})
