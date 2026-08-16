import { useEnv } from '../utils/env'

/**
 * Read at runtime rather than baked in at build, so a self-hoster can add
 * Google credentials and restart without rebuilding the app.
 */
export default defineEventHandler(() => {
  const env = useEnv()

  return { google: Boolean(env.googleClientId && env.googleClientSecret) }
})
