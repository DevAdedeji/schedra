import { workflowIdSchema, workflowInputSchema } from '#shared/workflows'
import { requireAuthSession } from '../../services/session'
import { updateWorkflow } from '../../services/workflows'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const id = workflowIdSchema.safeParse(getRouterParam(event, 'id'))
  const parsed = await readValidatedBody(event, workflowInputSchema.safeParse)
  if (!id.success || !parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.success ? 'Invalid workflow.' : parsed.error.issues[0]?.message })
  }
  const updated = await updateWorkflow({ userId: session.user.id }, id.data, parsed.data)
  if (!updated) throw createError({ statusCode: 404, statusMessage: 'Workflow not found.' })
  return updated
})
