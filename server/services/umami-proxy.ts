import { isIP } from 'node:net'
import { z } from 'zod'
import { UMAMI_WEBSITE_ID } from '#shared/analytics'

export const UMAMI_SCRIPT_URL = 'https://cloud.umami.is/script.js'
export const UMAMI_EVENT_URL = 'https://gateway.umami.is/api/send'
export const UMAMI_PROXY_TIMEOUT_MS = 5_000
export const UMAMI_EVENT_BODY_BYTES = 16 * 1024

const safePagePath = z.string()
  .max(160)
  .regex(/^\/[a-z0-9/-]*$/, 'Analytics page paths must be normalized categories.')

const safeReferrer = z.string().max(2048).refine((value) => {
  if (!value) return true
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol)
      && value === url.origin
      && url.username === ''
      && url.password === ''
  } catch {
    return false
  }
}, 'Analytics referrers must contain an origin only.')

const umamiEventSchema = z.object({
  type: z.literal('event'),
  payload: z.object({
    website: z.literal(UMAMI_WEBSITE_ID),
    screen: z.string().regex(/^\d{1,5}x\d{1,5}$/),
    language: z.string().min(1).max(35).regex(/^[a-z0-9-]+$/i),
    title: z.string().min(1).max(160),
    hostname: z.string().min(1).max(253),
    url: safePagePath,
    referrer: safeReferrer
  })
})

export type UmamiEvent = z.infer<typeof umamiEventSchema>

/**
 * Rebuild the event from an allowlist. Unexpected fields such as form data,
 * custom event payloads or future tracker additions cannot pass the proxy.
 */
export function parseUmamiEvent(value: unknown, expectedHostname: string): UmamiEvent {
  const event = umamiEventSchema.parse(value)
  if (event.payload.hostname !== expectedHostname) {
    throw new Error('Analytics hostname does not match this Schedra environment.')
  }
  return event
}

function boundedHeader(value: string | undefined, maximumLength: number) {
  const header = value?.trim()
  return header && header.length <= maximumLength ? header : undefined
}

export function umamiForwardHeaders(input: {
  hostname: string
  userAgent?: string
  acceptLanguage?: string
  clientIp?: string
  cacheKey?: string
}) {
  const headers = new Headers({
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': boundedHeader(input.userAgent, 512) ?? 'Schedra-Analytics-Proxy/1.0',
    'x-umami-website-id': UMAMI_WEBSITE_ID,
    'x-umami-hostname': input.hostname
  })

  const acceptLanguage = boundedHeader(input.acceptLanguage, 128)
  if (acceptLanguage) headers.set('Accept-Language', acceptLanguage)

  const clientIp = boundedHeader(input.clientIp, 64)
  if (clientIp && isIP(clientIp)) headers.set('X-Forwarded-For', clientIp)

  const cacheKey = boundedHeader(input.cacheKey, 2048)
  if (cacheKey && /^[a-z0-9+/=._-]+$/i.test(cacheKey)) {
    headers.set('x-umami-cache', cacheKey)
  }

  return headers
}
