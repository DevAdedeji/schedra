import { useEnv } from '../../../config/env'
import { fetchWithTimeout } from '../../../integrations/fetch'
import { logEvent } from '../../../observability/logger'
import { enforceBoundedRequestBody } from '../../../security/request-body'
import {
  parseUmamiEvent,
  UMAMI_EVENT_BODY_BYTES,
  UMAMI_EVENT_URL,
  umamiForwardHeaders,
  UMAMI_PROXY_TIMEOUT_MS
} from '../../../services/umami-proxy'

export default defineEventHandler(async (event) => {
  if (getHeader(event, 'sec-fetch-site')?.toLowerCase() === 'cross-site') {
    throw createError({ statusCode: 403, statusMessage: 'Cross-site analytics requests are not allowed.' })
  }

  const expectedOrigin = new URL(useEnv().schedraUrl).origin
  const requestOrigin = getHeader(event, 'origin')
  if (requestOrigin && requestOrigin !== expectedOrigin) {
    throw createError({ statusCode: 403, statusMessage: 'Analytics request origin is not allowed.' })
  }

  const contentType = getHeader(event, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw createError({ statusCode: 415, statusMessage: 'Analytics requests must use application/json.' })
  }

  await enforceBoundedRequestBody(event, UMAMI_EVENT_BODY_BYTES)
  const rawBody = await readRawBody(event, 'utf8')
  if (!rawBody) throw createError({ statusCode: 400, statusMessage: 'Analytics event is required.' })

  let body: ReturnType<typeof parseUmamiEvent>
  try {
    body = parseUmamiEvent(JSON.parse(rawBody), new URL(expectedOrigin).hostname)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Analytics event is invalid.' })
  }

  try {
    const response = await fetchWithTimeout(UMAMI_EVENT_URL, {
      method: 'POST',
      headers: umamiForwardHeaders({
        hostname: body.payload.hostname,
        userAgent: getHeader(event, 'user-agent'),
        acceptLanguage: getHeader(event, 'accept-language'),
        clientIp: getRequestIP(event, { xForwardedFor: true }),
        cacheKey: getHeader(event, 'x-umami-cache')
      }),
      body: JSON.stringify(body)
    }, UMAMI_PROXY_TIMEOUT_MS)

    const responseBody = await response.text()
    setResponseStatus(event, response.status)
    setResponseHeaders(event, {
      'Cache-Control': 'no-store',
      'Content-Type': response.headers.get('content-type')?.startsWith('application/json')
        ? 'application/json; charset=utf-8'
        : 'text/plain; charset=utf-8'
    })
    return responseBody
  } catch (error) {
    logEvent('warn', 'umami_event_proxy_failed', { error }, event)
    throw createError({ statusCode: 502, statusMessage: 'Usage analytics are temporarily unavailable.' })
  }
})
