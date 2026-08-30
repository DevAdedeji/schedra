import { describe, expect, it } from 'vitest'
import {
  apiBodyLimit,
  AVATAR_BODY_BYTES,
  BRAND_LOGO_BODY_BYTES,
  requestProtectionFailure,
  sensitiveRateLimit,
  WEBHOOK_BODY_BYTES
} from '../security/request-protection'

const request = {
  pathname: '/api/profile',
  method: 'PATCH',
  expectedOrigin: 'https://schedra.example'
}

describe('API request protection', () => {
  it('accepts same-origin browser mutations', () => {
    expect(requestProtectionFailure({
      ...request,
      origin: 'https://schedra.example',
      fetchSite: 'same-origin',
      contentLength: '1024'
    })).toBeUndefined()
  })

  it('allows non-browser clients without browser-only headers', () => {
    expect(requestProtectionFailure(request)).toBeUndefined()
  })

  it('blocks cross-site and mismatched-origin mutations', () => {
    expect(requestProtectionFailure({ ...request, fetchSite: 'cross-site' })).toMatchObject({ statusCode: 403 })
    expect(requestProtectionFailure({ ...request, origin: 'https://attacker.example' })).toMatchObject({ statusCode: 403 })
    expect(requestProtectionFailure({ ...request, origin: 'not a URL' })).toMatchObject({ statusCode: 403 })
  })

  it('rejects oversized API mutations but does not affect reads', () => {
    expect(requestProtectionFailure({
      ...request,
      contentLength: String(64 * 1024 + 1)
    })).toMatchObject({ statusCode: 413 })
    expect(requestProtectionFailure({
      ...request,
      method: 'GET',
      contentLength: String(64 * 1024 + 1),
      origin: 'https://attacker.example'
    })).toBeUndefined()
  })

  it('uses narrow defaults with explicit upload and provider exceptions', () => {
    expect(apiBodyLimit('/api/profile/avatar')).toBe(AVATAR_BODY_BYTES)
    expect(apiBodyLimit('/api/profile/brand-logo')).toBe(BRAND_LOGO_BODY_BYTES)
    expect(apiBodyLimit('/api/teams/acme/brand-logo')).toBe(BRAND_LOGO_BODY_BYTES)
    expect(apiBodyLimit('/api/webhooks/bachs')).toBe(WEBHOOK_BODY_BYTES)
    expect(apiBodyLimit('/api/auth/sign-in/email')).toBe(16 * 1024)
    expect(apiBodyLimit('/api/bookings')).toBe(64 * 1024)
  })

  it('allows multipart overhead for personal and team brand logos only', () => {
    for (const pathname of ['/api/profile/brand-logo', '/api/teams/acme/brand-logo']) {
      const maxBodyBytes = apiBodyLimit(pathname)
      expect(requestProtectionFailure({
        ...request,
        pathname,
        method: 'PUT',
        contentLength: String(2 * 1024 * 1024 + 32 * 1024),
        maxBodyBytes
      })).toBeUndefined()
      expect(requestProtectionFailure({
        ...request,
        pathname,
        method: 'PUT',
        contentLength: String(maxBodyBytes + 1),
        maxBodyBytes
      })).toMatchObject({ statusCode: 413 })
    }
    expect(apiBodyLimit('/api/teams/acme/brand-logo/extra')).toBe(64 * 1024)
  })

  it('adds stricter policies for authentication and destructive actions', () => {
    expect(sensitiveRateLimit('/api/auth/sign-in/email', 'POST')).toMatchObject({ limit: 10 })
    expect(sensitiveRateLimit('/api/account', 'DELETE')).toMatchObject({ limit: 3 })
    expect(sensitiveRateLimit('/api/account', 'GET')).toBeUndefined()
  })

  it('rejects malformed declared lengths', () => {
    expect(requestProtectionFailure({ ...request, contentLength: '-1' })).toMatchObject({ statusCode: 400 })
    expect(requestProtectionFailure({ ...request, contentLength: 'not-a-number' })).toMatchObject({ statusCode: 400 })
  })
})
