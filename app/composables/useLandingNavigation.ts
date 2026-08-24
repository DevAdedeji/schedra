export async function useLandingNavigation() {
  // The landing page is prerendered and shared by every visitor. Resolve the
  // session only after hydration so one user's signed-in CTA can never become
  // cached HTML for another visitor.
  const { data: currentUser } = await useCurrentUser({ server: false })

  const isSignedIn = computed(() => Boolean(currentUser.value.user))
  const accountDestination = computed(() => isSignedIn.value ? '/dashboard' : '/signup')

  return {
    isSignedIn,
    accountDestination
  }
}
