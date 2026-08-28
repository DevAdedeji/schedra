import { workflowInputSchema } from '#shared/workflows'
import { requireAuthSession } from '../../services/session'
import { createWorkflow } from '../../services/workflows'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const parsed = await readValidatedBody(event, workflowInputSchema.safeParse)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'That workflow is not valid.' })
  }
  const created = await createWorkflow({ userId: session.user.id }, session.user.id, parsed.data)
  setResponseStatus(event, 201)
  return created
})
