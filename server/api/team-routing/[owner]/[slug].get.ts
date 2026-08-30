import { enforceRateLimit } from '../../../services/rate-limit'
import { findPublicRoutingForm } from '../../../services/routing-forms'
import { storedTeamBranding } from '../../../services/team-branding'

export default defineEventHandler(async (event) => {
  await enforceRateLimit(event, { namespace: 'team-routing-form', limit: 120, windowSeconds: 60 })
  const form = await findPublicRoutingForm(getRouterParam(event, 'owner') ?? '', getRouterParam(event, 'slug') ?? '', true)
  if (!form) throw createError({ statusCode: 404, statusMessage: 'Routing form not found.' })
  return {
    title: form.title,
    description: form.description,
    questions: form.questions,
    ownerName: form.ownerName,
    branding: await storedTeamBranding(form.organizationId!)
  }
})
