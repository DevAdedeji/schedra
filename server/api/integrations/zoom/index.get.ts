import { zoomConnection } from '../../../integrations/video/zoom'
import { requireAuthSession } from '../../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  return zoomConnection(session.user.id)
})
