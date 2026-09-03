export default defineNuxtRouteMiddleware(async () => {
  const { data } = await useCurrentUser()
  setPageLayout(data.value?.user ? 'app' : 'bare')
})
