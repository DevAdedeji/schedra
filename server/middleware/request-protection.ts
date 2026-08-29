import { getHeader, getRequestURL, setResponseHeader } from 'h3'
import { useEnv } from '../config/env'
import { enforceRateLimit } from '../services/rate-limit'
import { enforceBoundedRequestBody } from '../security/request-body'
import {
  apiBodyLimit,
  requestProtectionFailure,
  sensitiveRateLimit
} from '../security/request-protection'

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event)
  if (!url.pathname.startsWith('/api/')) return

  // API responses can include account, attendee and capability-link data. Do
  // not let a browser, proxy or CDN retain them without an endpoint opting in.
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Pragma', 'no-cache')

  // SameSite cookies are the primary CSRF boundary. These checks add a second
  // browser-enforced boundary while still allowing non-browser clients that do
  // not send Fetch Metadata or Origin headers.
  const maxBodyBytes = apiBodyLimit(url.pathname)
  const failure = requestProtectionFailure({
    pathname: url.pathname,
    method: event.method,
    contentLength: getHeader(event, 'content-length'),
    fetchSite: getHeader(event, 'sec-fetch-site'),
    origin: getHeader(event, 'origin'),
    expectedOrigin: useEnv().schedraUrl,
    maxBodyBytes
  })
  if (failure) throw createError(failure)

  const rateLimit = sensitiveRateLimit(url.pathname, event.method)
  if (rateLimit) await enforceRateLimit(event, rateLimit)

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(event.method.toUpperCase())) {
    await enforceBoundedRequestBody(event, maxBodyBytes)
  }
})
