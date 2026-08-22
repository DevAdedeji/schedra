import { getAuthSession } from '../utils/session'
import { useEnv } from '../utils/env'
import { ensureStarterSetup } from '../utils/onboarding'

export default defineEventHandler(async (event) => {
  const env = useEnv()
  // Bundled with the session so an auth page needs one round trip, not two.
  const google = Boolean(env.googleClientId && env.googleClientSecret)

  const session = await getAuthSession(event)
  if (!session) return { user: null, google }

  const { id, name, email, username, timeZone, bio } = session.user as typeof session.user & {
    username: string
    timeZone: string
    bio: string | null
  }
  await ensureStarterSetup(id, timeZone || 'UTC')

  return { user: { id, name, email, username, timeZone, bio }, google }
})
