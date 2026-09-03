import {
  analyticsPageForRoute,
  analyticsReferrerOrigin,
  UMAMI_PROXY_PATH,
  UMAMI_WEBSITE_ID
} from '#shared/analytics'

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

  function loadTracker() {
    if (document.querySelector('#umami-tracker')) return

    const script = document.createElement('script')
    script.id = 'umami-tracker'
    script.src = `${UMAMI_PROXY_PATH}/client.js`
    script.async = true
    script.dataset.websiteId = UMAMI_WEBSITE_ID
    script.dataset.hostUrl = UMAMI_PROXY_PATH
    script.dataset.autoTrack = 'false'
    script.dataset.doNotTrack = 'true'
    script.addEventListener('load', trackPageview, { once: true })
    document.head.append(script)
  }

  function scheduleTracker() {
    // Analytics should never compete with the page's visible content. The
    // timeout still records a visit when the browser never becomes idle.
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(loadTracker, { timeout: 2_000 })
      return
    }
    setTimeout(loadTracker, 1_000)
  }

  onNuxtReady(() => {
    if (document.readyState === 'complete') scheduleTracker()
    else window.addEventListener('load', scheduleTracker, { once: true })
  })

  nuxtApp.hook('page:finish', trackPageview)
})
