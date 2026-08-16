import { useEnv } from '../utils/env'

export default defineEventHandler(() => {
  const env = useEnv()

  return { google: Boolean(env.googleClientId && env.googleClientSecret) }
})
