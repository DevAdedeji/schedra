import { randomBytes } from 'node:crypto'
import { googleAuthorizationUrl } from '../../../utils/google-calendar'
import { useEnv } from '../../../utils/env'
import { requireAuthSession } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const state = randomBytes(32).toString('base64url')

  setCookie(event, 'schedra_google_calendar_state', state, {
    httpOnly: true,
    secure: new URL(useEnv().schedraUrl).protocol === 'https:',
    sameSite: 'lax',
    path: '/api/integrations/google-calendar',
    maxAge: 10 * 60
  })

  return sendRedirect(event, googleAuthorizationUrl(state, session.user.email))
})
