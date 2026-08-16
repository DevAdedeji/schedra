export default defineNuxtRouteMiddleware(async () => {
  const { data } = await useCurrentUser()

  if (data.value?.user) {
    return navigateTo('/dashboard')
  }
})
