import { workflowIdSchema } from '#shared/workflows'
import { requireOrganizationPermission } from '../../../../services/organization'
import { deleteWorkflow } from '../../../../services/workflows'

export default defineEventHandler(async (event) => {
  const context = await requireOrganizationPermission(event, getRouterParam(event, 'slug') ?? '', { workflow: ['delete'] })
  const id = workflowIdSchema.safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 400, statusMessage: 'Invalid workflow.' })
  if (!await deleteWorkflow({ organizationId: context.organization.id }, id.data)) {
    throw createError({ statusCode: 404, statusMessage: 'Workflow not found.' })
  }
  return { ok: true }
})
