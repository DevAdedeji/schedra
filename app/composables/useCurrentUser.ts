export function useCurrentUser() {
  return useFetch('/api/me', {
    key: 'current-user',
    default: () => ({ user: null })
  })
}
