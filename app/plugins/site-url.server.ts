export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const event = useRequestEvent()
  const fromEnv = event?.context.siteUrl as string | undefined

  if (fromEnv) {
    config.public.siteUrl = fromEnv
  }
})
