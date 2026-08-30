import { removeResponseHeader, setResponseHeaders } from 'h3'
import { useEnv } from '../config/env'

export default defineNitroPlugin((nitro) => {
  if (import.meta.prerender) return

  const secureOrigin = new URL(useEnv().schedraUrl).protocol === 'https:'

  nitro.hooks.hook('request', (event) => {
    const pathname = event.path.split('?')[0] ?? ''
    const embedDocument = pathname.startsWith('/embed/')
    const embedScript = pathname === '/embed.js'

    setResponseHeaders(event, {
      'Cross-Origin-Opener-Policy': embedDocument ? 'unsafe-none' : 'same-origin',
      'Cross-Origin-Resource-Policy': embedDocument || embedScript ? 'cross-origin' : 'same-origin',
      'Origin-Agent-Cluster': '?1',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Content-Type-Options': 'nosniff',
      'X-DNS-Prefetch-Control': 'off',
      ...(embedDocument ? {} : { 'X-Frame-Options': 'DENY' })
    })

    if (embedScript) {
      setResponseHeaders(event, {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400'
      })
    }

    if (secureOrigin) {
      setResponseHeaders(event, {
        'Content-Security-Policy': [
          `default-src 'self'`,
          `base-uri 'self'`,
          `connect-src 'self' https://cloud.umami.is https://gateway.umami.is`,
          `font-src 'self' data:`,
          `form-action 'self'`,
          embedDocument ? `frame-ancestors http: https:` : `frame-ancestors 'none'`,
          `img-src 'self' data: https:`,
          `manifest-src 'self'`,
          `media-src 'none'`,
          `object-src 'none'`,
          `script-src 'self' 'unsafe-inline' https://cloud.umami.is`,
          `script-src-attr 'none'`,
          `style-src 'self' 'unsafe-inline'`,
          `worker-src 'self' blob:`,
          'upgrade-insecure-requests'
        ].join('; '),
        'Strict-Transport-Security': 'max-age=63072000; includeSubDomains'
      })
    }
  })

  nitro.hooks.hook('beforeResponse', (event) => {
    removeResponseHeader(event, 'x-powered-by')
  })
})
