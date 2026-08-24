export async function useLandingNavigation() {
  const { data: currentUser } = await useCurrentUser()

  const isSignedIn = computed(() => Boolean(currentUser.value.user))
  const accountDestination = computed(() => isSignedIn.value ? '/dashboard' : '/signup')

  return {
    isSignedIn,
    accountDestination
  }
}
