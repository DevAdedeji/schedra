import { routingFormInputSchema } from '#shared/routing'
import { updateRoutingForm } from '../../services/routing-forms'
import { requireAuthSession } from '../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const parsed = await readValidatedBody(event, routingFormInputSchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Check this routing form.' })
  try {
    const updated = await updateRoutingForm({ userId: session.user.id }, getRouterParam(event, 'id') ?? '', parsed.data)
    if (!updated) throw createError({ statusCode: 404, statusMessage: 'Routing form not found.' })
    return updated
  } catch (failure) {
    if ((failure as { code?: string }).code === '23505') {
      throw createError({ statusCode: 409, statusMessage: 'That routing link is already in use.' })
    }
    throw failure
  }
})
