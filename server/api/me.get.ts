import { getAuthSession } from '../utils/session'
import { useEnv } from '../utils/env'

export default defineEventHandler(async (event) => {
  const env = useEnv()
  // Bundled with the session so an auth page needs one round trip, not two.
  const google = Boolean(env.googleClientId && env.googleClientSecret)

  const session = await getAuthSession(event)
  if (!session) return { user: null, google }

  const { id, name, email, username, timeZone } = session.user

  return { user: { id, name, email, username, timeZone }, google }
})
