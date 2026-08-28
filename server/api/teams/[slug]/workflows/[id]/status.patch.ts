import { z } from 'zod'
import { workflowIdSchema } from '#shared/workflows'
import { requireOrganizationPermission } from '../../../../../services/organization'
import { setWorkflowActive } from '../../../../../services/workflows'

const statusSchema = z.object({ active: z.boolean() })

export default defineEventHandler(async (event) => {
  const context = await requireOrganizationPermission(event, getRouterParam(event, 'slug') ?? '', { workflow: ['update'] })
  const id = workflowIdSchema.safeParse(getRouterParam(event, 'id'))
  const parsed = await readValidatedBody(event, statusSchema.safeParse)
  if (!id.success || !parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid workflow status.' })
  if (!await setWorkflowActive({ organizationId: context.organization.id }, id.data, parsed.data.active)) {
    throw createError({ statusCode: 404, statusMessage: 'Workflow not found.' })
  }
  return { ok: true }
})
