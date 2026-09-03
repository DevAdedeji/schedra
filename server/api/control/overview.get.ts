import { requirePlatformAdminSession } from '../../services/session'
import { controlOverview } from '../../services/control'

export default defineEventHandler(async (event) => {
  await requirePlatformAdminSession(event)
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  return controlOverview()
})
