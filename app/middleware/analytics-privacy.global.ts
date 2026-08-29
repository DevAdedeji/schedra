import { analyticsAllowedForRoute } from '#shared/analytics'

/**
 * Microsoft recommends removing Clarity from pages that must not be recorded.
 * An already-running recorder survives an SPA navigation, so crossing from a
 * marketing page into a sensitive route uses one document navigation. The new
 * document is rendered without the Clarity script at all.
 */
export default defineNuxtRouteMiddleware((to) => {
  if (import.meta.server || import.meta.dev || analyticsAllowedForRoute(to.name)) return

  const clarity = (window as typeof window & { clarity?: unknown }).clarity
  if (typeof clarity !== 'function') return

  window.location.assign(to.fullPath)
  return abortNavigation()
})
