import { workflowIdSchema } from '#shared/workflows'
import { requireAuthSession } from '../../services/session'
import { deleteWorkflow } from '../../services/workflows'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const id = workflowIdSchema.safeParse(getRouterParam(event, 'id'))
  if (!id.success) throw createError({ statusCode: 400, statusMessage: 'Invalid workflow.' })
  if (!await deleteWorkflow({ userId: session.user.id }, id.data)) {
    throw createError({ statusCode: 404, statusMessage: 'Workflow not found.' })
  }
  return { ok: true }
})
