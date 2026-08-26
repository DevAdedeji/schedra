import { getAuthSession } from '../services/session'
import { useEnv } from '../config/env'
import { ensureStarterSetup } from '../services/onboarding'
import { profileForUser } from '../repositories/profile'

export default defineEventHandler(async (event) => {
  const env = useEnv()
  // Bundled with the session so an auth page needs one round trip, not two.
  const google = Boolean(env.googleClientId && env.googleClientSecret)

  const session = await getAuthSession(event)
  if (!session) return { user: null, google }

  const profile = await profileForUser(session.user.id)
  if (!profile) return { user: null, google }
  await ensureStarterSetup(profile.id, profile.timeZone || 'UTC')

  return { user: profile, google }
})
