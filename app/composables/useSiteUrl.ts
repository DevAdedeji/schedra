const PRODUCTION_HOST = 'schedra.xyz'

export function useSiteUrl() {
  const configured = useRuntimeConfig().public.siteUrl

  const url = computed(() => configured || useRequestURL().origin)
  const host = computed(() => url.value.replace(/^https?:\/\//, '').replace(/\/$/, ''))
  const indexable = computed(() => host.value === PRODUCTION_HOST)

  return { url, host, indexable }
}
