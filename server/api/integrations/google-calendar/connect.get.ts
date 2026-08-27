import { randomBytes } from 'node:crypto'
import { googleAuthorizationUrl } from '../../../integrations/calendar/google'
import { useEnv } from '../../../config/env'
import { requireAuthSession } from '../../../services/session'
import { createOAuthPkce } from '../../../security/oauth'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const state = randomBytes(32).toString('base64url')
  const pkce = createOAuthPkce()

  const cookieOptions = {
    httpOnly: true,
    secure: new URL(useEnv().schedraUrl).protocol === 'https:',
    sameSite: 'lax' as const,
    path: '/api/integrations/google-calendar',
    maxAge: 10 * 60
  }

  setCookie(event, 'schedra_google_calendar_state', state, {
    ...cookieOptions
  })
  setCookie(event, 'schedra_google_calendar_pkce', pkce.verifier, cookieOptions)

  return sendRedirect(event, googleAuthorizationUrl(state, session.user.email, pkce.challenge))
})
