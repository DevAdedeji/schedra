import { analyticsPageForRoute, analyticsReferrerOrigin } from '#shared/analytics'

type UmamiPageviewProperties = Record<string, unknown> & {
  url?: string
  title?: string
  referrer?: string
}

type UmamiTracker = {
  track: (payload: (properties: UmamiPageviewProperties) => UmamiPageviewProperties) => void
}

declare global {
  interface Window {
    umami?: UmamiTracker
  }
}

function doNotTrackEnabled() {
  return navigator.doNotTrack === '1'
    || (window as typeof window & { doNotTrack?: string }).doNotTrack === '1'
}

export default defineNuxtPlugin((nuxtApp) => {
  if (import.meta.dev || doNotTrackEnabled()) return

  const route = useRoute()
  let lastTrackedNavigation = ''

  function trackPageview() {
    const tracker = window.umami
    if (!tracker || route.fullPath === lastTrackedNavigation) return

    const page = analyticsPageForRoute(route.name)
    tracker.track(properties => ({
      ...properties,
      url: page.path,
      title: page.title,
      referrer: analyticsReferrerOrigin(properties.referrer)
    }))
    lastTrackedNavigation = route.fullPath
  }

  onNuxtReady(() => {
    const script = document.querySelector<HTMLScriptElement>('#umami-tracker')
    script?.addEventListener('load', trackPageview, { once: true })
    trackPageview()
  })

  nuxtApp.hook('page:finish', trackPageview)
})
