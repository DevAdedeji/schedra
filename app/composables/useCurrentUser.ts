/**
 * Session state fetched through the server so it resolves during SSR — the
 * better-auth Vue client only knows the session once it is on the client, which
 * would flash a signed-out page for a signed-in visitor.
 */
export function useCurrentUser() {
  return useFetch('/api/me', {
    key: 'current-user',
    default: () => ({ user: null })
  })
}
