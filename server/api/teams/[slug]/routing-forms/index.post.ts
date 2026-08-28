import { routingFormInputSchema } from '#shared/routing'
import { assertTeamWritable } from '../../../../services/entitlement'
import { requireOrganizationPermission } from '../../../../services/organization'
import { createRoutingForm } from '../../../../services/routing-forms'

export default defineEventHandler(async (event) => {
  const context = await requireOrganizationPermission(event, getRouterParam(event, 'slug') ?? '', { eventType: ['create'] })
  await assertTeamWritable(context.organization.id)
  const parsed = await readValidatedBody(event, routingFormInputSchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Check this routing form.' })
  try {
    const created = await createRoutingForm({ organizationId: context.organization.id }, parsed.data)
    setResponseStatus(event, 201)
    return created
  } catch (failure) {
    if ((failure as { code?: string }).code === '23505') throw createError({ statusCode: 409, statusMessage: 'That team routing link is already in use.' })
    throw failure
  }
})
