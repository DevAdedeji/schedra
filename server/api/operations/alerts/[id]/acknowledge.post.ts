import { acknowledgeOperationsAlert } from '../../../../services/operations'
import { requirePlatformAdminSession } from '../../../../services/session'

export default defineEventHandler(async (event) => {
  await requirePlatformAdminSession(event)
  const id = getRouterParam(event, 'id') ?? ''
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Choose an alert to acknowledge.' })
  const acknowledged = await acknowledgeOperationsAlert(id)
  if (!acknowledged) throw createError({ statusCode: 404, statusMessage: 'This alert is no longer active.' })
  return { acknowledged: true as const }
})
