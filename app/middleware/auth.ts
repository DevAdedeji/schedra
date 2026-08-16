export default defineNuxtRouteMiddleware(async (to) => {
  const { data } = await useCurrentUser()

  if (!data.value?.user) {
    return navigateTo(`/login?next=${encodeURIComponent(to.fullPath)}`)
  }
})
