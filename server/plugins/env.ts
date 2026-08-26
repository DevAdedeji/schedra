import { useEnv } from '../config/env'

export default defineNitroPlugin((nitro) => {
  if (import.meta.prerender) return

  const env = useEnv()

  nitro.hooks.hook('request', (event) => {
    event.context.siteUrl = env.schedraUrl
  })
})
