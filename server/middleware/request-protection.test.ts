import { describe, expect, it } from 'vitest'
import { requestProtectionFailure } from '../utils/request-protection'

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
})
