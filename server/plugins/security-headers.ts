import { removeResponseHeader, setResponseHeaders } from 'h3'
import { useEnv } from '../utils/env'

export default defineNitroPlugin((nitro) => {
  if (import.meta.prerender) return

  const secureOrigin = new URL(useEnv().schedraUrl).protocol === 'https:'

  nitro.hooks.hook('request', (event) => {
    setResponseHeaders(event, {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Origin-Agent-Cluster': '?1',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Content-Type-Options': 'nosniff',
      'X-DNS-Prefetch-Control': 'off',
      'X-Frame-Options': 'DENY'
    })

    if (secureOrigin) {
      setResponseHeaders(event, {
        'Content-Security-Policy': [
          `default-src 'self'`,
          `base-uri 'self'`,
          `connect-src 'self'`,
          `font-src 'self' data:`,
          `form-action 'self'`,
          `frame-ancestors 'none'`,
          `img-src 'self' data: https:`,
          `manifest-src 'self'`,
          `media-src 'none'`,
          `object-src 'none'`,
          `script-src 'self' 'unsafe-inline'`,
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
