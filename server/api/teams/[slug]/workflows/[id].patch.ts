import { workflowIdSchema, workflowInputSchema } from '#shared/workflows'
import { requireOrganizationPermission } from '../../../../services/organization'
import { updateWorkflow } from '../../../../services/workflows'

export default defineEventHandler(async (event) => {
  const context = await requireOrganizationPermission(event, getRouterParam(event, 'slug') ?? '', { workflow: ['update'] })
  const id = workflowIdSchema.safeParse(getRouterParam(event, 'id'))
  const parsed = await readValidatedBody(event, workflowInputSchema.safeParse)
  if (!id.success || !parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.success ? 'Invalid workflow.' : parsed.error.issues[0]?.message })
  }
  const updated = await updateWorkflow({ organizationId: context.organization.id }, id.data, parsed.data)
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Workflow not found.' })
  return updated
})
