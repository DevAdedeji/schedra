import { randomBytes } from 'node:crypto'
import { microsoftAuthorizationUrl } from '../../../integrations/calendar/microsoft'
import { useEnv } from '../../../config/env'
import { requireAuthSession } from '../../../services/session'

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event)
  const state = randomBytes(32).toString('base64url')

  setCookie(event, 'schedra_microsoft_calendar_state', state, {
    httpOnly: true,
    secure: new URL(useEnv().schedraUrl).protocol === 'https:',
    sameSite: 'lax',
    path: '/api/integrations/microsoft-calendar',
    maxAge: 10 * 60
  })

  return sendRedirect(event, microsoftAuthorizationUrl(state, session.user.email))
})
