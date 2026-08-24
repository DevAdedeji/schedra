import { getHeader, getRequestURL, setResponseHeader } from 'h3'
import { useEnv } from '../utils/env'
import { requestProtectionFailure } from '../utils/request-protection'

export default defineEventHandler((event) => {
  const url = getRequestURL(event)
  if (!url.pathname.startsWith('/api/')) return

  // API responses can include account, attendee and capability-link data. Do
  // not let a browser, proxy or CDN retain them without an endpoint opting in.
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Pragma', 'no-cache')

  // SameSite cookies are the primary CSRF boundary. These checks add a second
  // browser-enforced boundary while still allowing non-browser clients that do
  // not send Fetch Metadata or Origin headers.
  const failure = requestProtectionFailure({
    pathname: url.pathname,
    method: event.method,
    contentLength: getHeader(event, 'content-length'),
    fetchSite: getHeader(event, 'sec-fetch-site'),
    origin: getHeader(event, 'origin'),
    expectedOrigin: useEnv().schedraUrl
  })
  if (failure) throw createError(failure)
})
