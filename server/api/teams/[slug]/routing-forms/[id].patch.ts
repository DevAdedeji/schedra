import { routingFormInputSchema } from '#shared/routing'
import { assertTeamWritable } from '../../../../services/entitlement'
import { requireOrganizationPermission } from '../../../../services/organization'
import { updateRoutingForm } from '../../../../services/routing-forms'

export default defineEventHandler(async (event) => {
  const context = await requireOrganizationPermission(event, getRouterParam(event, 'slug') ?? '', { eventType: ['update'] })
  await assertTeamWritable(context.organization.id)
  const parsed = await readValidatedBody(event, routingFormInputSchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Check this routing form.' })
  try {
    const updated = await updateRoutingForm({ organizationId: context.organization.id }, getRouterParam(event, 'id') ?? '', parsed.data)
    if (!updated) throw createError({ statusCode: 404, statusMessage: 'Routing form not found.' })
    return updated
  } catch (failure) {
    if ((failure as { code?: string }).code === '23505') throw createError({ statusCode: 409, statusMessage: 'That team routing link is already in use.' })
    throw failure
  }
})
