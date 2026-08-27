import { randomBytes } from 'node:crypto'
import { zoomAuthorizationUrl } from '../../../integrations/video/zoom'
import { useEnv } from '../../../config/env'
import { requireAuthSession } from '../../../services/session'
import { createOAuthPkce } from '../../../security/oauth'

export default defineEventHandler(async (event) => {
  await requireAuthSession(event)
  const state = randomBytes(32).toString('base64url')
  const pkce = createOAuthPkce()

  const cookieOptions = {
    httpOnly: true,
    secure: new URL(useEnv().schedraUrl).protocol === 'https:',
    sameSite: 'lax' as const,
    path: '/api/integrations/zoom',
    maxAge: 10 * 60
  }

  setCookie(event, 'schedra_zoom_state', state, {
    ...cookieOptions
  })
  setCookie(event, 'schedra_zoom_pkce', pkce.verifier, cookieOptions)

  return sendRedirect(event, zoomAuthorizationUrl(state, pkce.challenge))
})
