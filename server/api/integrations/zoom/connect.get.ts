import { randomBytes } from 'node:crypto'
import { zoomAuthorizationUrl } from '../../../integrations/video/zoom'
import { useEnv } from '../../../config/env'
import { requireAuthSession } from '../../../services/session'

export default defineEventHandler(async (event) => {
  await requireAuthSession(event)
  const state = randomBytes(32).toString('base64url')

  setCookie(event, 'schedra_zoom_state', state, {
    httpOnly: true,
    secure: new URL(useEnv().schedraUrl).protocol === 'https:',
    sameSite: 'lax',
    path: '/api/integrations/zoom',
    maxAge: 10 * 60
  })

  return sendRedirect(event, zoomAuthorizationUrl(state))
})
