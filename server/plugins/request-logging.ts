import { getRequestURL, getResponseStatus, setResponseHeader } from 'h3'
import { logEvent } from '../observability/logger'

function safePath(pathname: string) {
  return pathname
    .replace(/^\/api\/booking\/[^/]+/, '/api/booking/:uid')
    .replace(/^\/api\/invitations\/[^/]+/, '/api/invitations/:id')
    .replace(/^\/invite\/[^/]+/, '/invite/:id')
    .replace(/^\/api\/meeting-links\/guest\/[^/]+/, '/api/meeting-links/guest/:token')
    .replace(/^\/meeting\/[^/]+/, '/meeting/:token')
    .replace(/^\/api\/avatar\/[^/]+/, '/api/avatar/:userId')
    .replace(/^\/api\/profile\/[^/]+/, '/api/profile/:username')
    .replace(/^\/api\/booking-page\/[^/]+\/[^/]+/, '/api/booking-page/:username/:slug')
    .replace(/^\/booking\/[^/]+/, '/booking/:uid')
}

export default defineNitroPlugin((nitro) => {
  if (import.meta.prerender) return

  nitro.hooks.hook('request', (event) => {
    const requestId = crypto.randomUUID()
    event.context.requestId = requestId
    event.context.requestStartedAt = performance.now()
    setResponseHeader(event, 'X-Request-Id', requestId)
  })

  nitro.hooks.hook('afterResponse', (event) => {
    const status = getResponseStatus(event)
    const durationMs = Math.round((performance.now() - event.context.requestStartedAt) * 10) / 10
    const level = status >= 500 ? 'error' : status >= 400 || durationMs >= 1000 ? 'warn' : 'info'
    logEvent(level, 'http_request', {
      requestId: event.context.requestId,
      method: event.method,
      path: safePath(getRequestURL(event).pathname),
      status,
      durationMs,
      slow: durationMs >= 1000
    }, event)
  })
})
