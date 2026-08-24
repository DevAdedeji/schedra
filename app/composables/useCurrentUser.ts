export function useCurrentUser() {
  // Unlike bare $fetch, useRequestFetch forwards the incoming cookie during
  // SSR, so a full-page navigation retains the authenticated session.
  const requestFetch = useRequestFetch()
  return useAsyncData('current-user', (_nuxtApp, { signal }) =>
    requestFetch('/api/me', { signal }), {
    default: () => ({ user: null, google: false }),
    dedupe: 'defer'
  })
}
