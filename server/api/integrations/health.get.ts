import { integrationSyncHealth } from '../../services/integration-health'
import { requireAuthSession } from '../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  return integrationSyncHealth(session.user.id)
})
