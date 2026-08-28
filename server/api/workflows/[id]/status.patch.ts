import { z } from 'zod'
import { workflowIdSchema } from '#shared/workflows'
import { requireAuthSession } from '../../../services/session'
import { setWorkflowActive } from '../../../services/workflows'

const statusSchema = z.object({ active: z.boolean() })

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const id = workflowIdSchema.safeParse(getRouterParam(event, 'id'))
  const parsed = await readValidatedBody(event, statusSchema.safeParse)
  if (!id.success || !parsed.success) throw createError({ statusCode: 400, statusMessage: 'Invalid workflow status.' })
  if (!await setWorkflowActive({ userId: session.user.id }, id.data, parsed.data.active)) {
    throw createError({ statusCode: 404, statusMessage: 'Workflow not found.' })
  }
  return { ok: true }
})
