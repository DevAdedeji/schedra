import { describe, expect, it } from 'vitest'
import { UMAMI_WEBSITE_ID } from '../../shared/analytics'
import { parseUmamiEvent, umamiForwardHeaders } from './umami-proxy'

const event = {
  type: 'event',
  payload: {
    website: UMAMI_WEBSITE_ID,
    screen: '1440x900',
    language: 'en-US',
    title: 'Personal booking page',
    hostname: 'schedra.xyz',
    url: '/booking/personal',
    referrer: 'https://google.com'
  }
} as const

describe('Umami proxy privacy boundary', () => {
  it('accepts a normalized page view', () => {
    expect(parseUmamiEvent(event, 'schedra.xyz')).toEqual(event)
  })

  it('removes fields outside the page-view allowlist', () => {
    const parsed = parseUmamiEvent({
      ...event,
      payload: {
        ...event.payload,
        name: 'form-submitted',
        data: { email: 'private@example.com' }
      }
    }, 'schedra.xyz')

    expect(parsed.payload).not.toHaveProperty('name')
    expect(parsed.payload).not.toHaveProperty('data')
  })

  it('rejects concrete URLs, detailed referrers and foreign website IDs', () => {
    expect(() => parseUmamiEvent({
      ...event,
      payload: { ...event.payload, url: '/adedeji/30min?email=private@example.com' }
    }, 'schedra.xyz')).toThrow()
    expect(() => parseUmamiEvent({
      ...event,
      payload: { ...event.payload, referrer: 'https://example.com/private/path' }
    }, 'schedra.xyz')).toThrow()
    expect(() => parseUmamiEvent({
      ...event,
      payload: { ...event.payload, website: '00000000-0000-0000-0000-000000000000' }
    }, 'schedra.xyz')).toThrow()
  })

  it('does not accept events attributed to another hostname', () => {
    expect(() => parseUmamiEvent(event, 'evil.example')).toThrow()
  })

  it('forwards only bounded analytics headers and valid IP addresses', () => {
    const headers = umamiForwardHeaders({
      hostname: 'schedra.xyz',
      userAgent: 'Test browser',
      acceptLanguage: 'en-US,en;q=0.9',
      clientIp: '203.0.113.8',
      cacheKey: 'safe-cache_key.1'
    })

    expect(headers.get('user-agent')).toBe('Test browser')
    expect(headers.get('accept-language')).toBe('en-US,en;q=0.9')
    expect(headers.get('x-forwarded-for')).toBe('203.0.113.8')
    expect(headers.get('x-umami-cache')).toBe('safe-cache_key.1')
    expect(headers.has('cookie')).toBe(false)
    expect(headers.has('authorization')).toBe(false)

    const rejected = umamiForwardHeaders({ hostname: 'schedra.xyz', clientIp: 'not-an-ip' })
    expect(rejected.has('x-forwarded-for')).toBe(false)
  })
})
