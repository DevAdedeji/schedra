export default defineNuxtRouteMiddleware(async () => {
  const { data } = await useCurrentUser()
  if (!data.value?.isPlatformAdmin) return navigateTo('/dashboard')
})
