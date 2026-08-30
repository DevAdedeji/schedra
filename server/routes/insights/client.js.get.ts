import { fetchWithTimeout } from '../../integrations/fetch'
import { logEvent } from '../../observability/logger'
import {
  UMAMI_PROXY_TIMEOUT_MS,
  UMAMI_SCRIPT_URL
} from '../../services/umami-proxy'

export default defineEventHandler(async (event) => {
  try {
    const response = await fetchWithTimeout(UMAMI_SCRIPT_URL, {
      headers: {
        'Accept': 'application/javascript',
        'User-Agent': 'Schedra-Analytics-Proxy/1.0'
      }
    }, UMAMI_PROXY_TIMEOUT_MS)

    if (!response.ok) throw new Error(`Umami returned HTTP ${response.status}.`)

    const script = await response.text()
    setResponseHeaders(event, {
      'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
      'Content-Type': 'application/javascript; charset=utf-8',
      'X-Content-Type-Options': 'nosniff'
    })
    return script
  } catch (error) {
    logEvent('warn', 'umami_script_proxy_failed', { error }, event)
    setResponseStatus(event, 503)
    setResponseHeaders(event, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/javascript; charset=utf-8'
    })
    return '/* Usage analytics are temporarily unavailable. */'
  }
})
