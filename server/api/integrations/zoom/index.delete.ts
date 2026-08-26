import { disconnectZoom } from '../../../integrations/video/zoom'
import { requireAuthSession } from '../../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  await disconnectZoom(session.user.id)
  setResponseStatus(event, 204)
  return null
})
