import { acknowledgeOperationsAlert } from '../../../../services/operations'
import { requirePlatformAdminSession } from '../../../../services/session'
import { recordSecurityAudit } from '../../../../services/security-audit'

export default defineEventHandler(async (event) => {
  const session = await requirePlatformAdminSession(event)
  const id = getRouterParam(event, 'id') ?? ''
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Choose an alert to acknowledge.' })
  const acknowledged = await acknowledgeOperationsAlert(id)
  if (!acknowledged) throw createError({ statusCode: 404, statusMessage: 'This alert is no longer active.' })
  await recordSecurityAudit({
    action: 'operations.alert_acknowledged',
    actorUserId: session.user.id,
    actorEmail: session.user.email,
    targetType: 'operations_alert',
    targetId: id
  }, event)
  return { acknowledged: true as const }
})
