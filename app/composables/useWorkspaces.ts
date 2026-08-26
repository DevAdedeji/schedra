import { workspacesApi, type WorkspaceDetail, type WorkspaceSummary } from '~/services/schedra-api'

export function useWorkspaces() {
  const requestFetch = useRequestFetch()
  return useAsyncData('workspaces', (_nuxtApp, { signal }) =>
    requestFetch<{ items: WorkspaceSummary[] }>(workspacesApi.listEndpoint, { signal }), {
    default: () => ({ items: [] as WorkspaceSummary[] }),
    dedupe: 'defer'
  })
}

/**
 * The workspace is read from the URL rather than a session value: two tabs open
 * on different workspaces must never act on each other's data.
 */
export function useWorkspace(slug: MaybeRefOrGetter<string>) {
  const requestFetch = useRequestFetch()
  const key = computed(() => `workspace:${toValue(slug)}`)

  return useAsyncData(key, (_nuxtApp, { signal }) =>
    requestFetch<WorkspaceDetail>(workspacesApi.detailEndpoint(toValue(slug)), { signal }), {
    watch: [key]
  })
}

export function useWorkspaceRouteSlug() {
  const route = useRoute()
  return computed(() => String(route.params.slug ?? ''))
}
