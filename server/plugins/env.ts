import { useEnv } from '../utils/env'

export default defineNitroPlugin(() => {
  if (import.meta.prerender) return

  useEnv()
})
