import { requirePlatformAdminSession } from '../../services/session'
import { operationsOverview } from '../../services/operations'

export default defineEventHandler(async (event) => {
  await requirePlatformAdminSession(event)
  return operationsOverview()
})
