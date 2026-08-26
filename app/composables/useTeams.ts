import { teamsApi, type TeamDetail, type TeamSummary } from '~/services/schedra-api'

export function useTeams() {
  const requestFetch = useRequestFetch()
  return useAsyncData('teams', (_nuxtApp, { signal }) =>
    requestFetch<{ items: TeamSummary[] }>(teamsApi.listEndpoint, { signal }), {
    default: () => ({ items: [] as TeamSummary[] }),
    dedupe: 'defer'
  })
}

/**
 * The team is read from the URL rather than a session value: two tabs open
 * on different teams must never act on each other's data.
 */
export function useTeam(slug: MaybeRefOrGetter<string>) {
  const requestFetch = useRequestFetch()
  const key = computed(() => `team:${toValue(slug)}`)

  return useAsyncData(key, (_nuxtApp, { signal }) =>
    requestFetch<TeamDetail>(teamsApi.detailEndpoint(toValue(slug)), { signal }), {
    watch: [key]
  })
}

export function useTeamRouteSlug() {
  const route = useRoute()
  return computed(() => String(route.params.slug ?? ''))
}
