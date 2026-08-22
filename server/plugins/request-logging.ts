import { getRequestURL, getResponseStatus, setResponseHeader } from 'h3'

function safePath(pathname: string) {
  return pathname
    .replace(/^\/api\/booking\/[^/]+/, '/api/booking/:uid')
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
    console.info(JSON.stringify({
      level: 'info',
      event: 'http_request',
      requestId: event.context.requestId,
      method: event.method,
      path: safePath(getRequestURL(event).pathname),
      status: getResponseStatus(event),
      durationMs: Math.round((performance.now() - event.context.requestStartedAt) * 10) / 10
    }))
  })
})
