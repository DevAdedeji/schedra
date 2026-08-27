import { requirePlatformAdminSession } from '../../services/session'
import { operationsDiagnostics } from '../../services/operations'

export default defineEventHandler(async (event) => {
  await requirePlatformAdminSession(event)
  return operationsDiagnostics()
})
