import { checkZoomConnection, ZoomUnavailableError } from '../../../integrations/video/zoom'
import { requireAuthSession } from '../../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  try {
    return await checkZoomConnection(session.user.id)
  } catch (error) {
    if (error instanceof ZoomUnavailableError) {
      throw createError({
        statusCode: error.retryable ? 503 : 409,
        statusMessage: error.message
      })
    }
    throw error
  }
})
