import postgres from 'postgres'
import type { H3Event } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureAppTestEnvironment, getTestDatabaseUrl } from '../../test/helpers/database'
import { enforceRateLimit } from './rate-limit'

const url = getTestDatabaseUrl()

describe.skipIf(!url)('API rate limiting', () => {
  const sql = postgres(url!, { max: 2, onnotice: () => {} })
  const responseHeaders = new Map<string, string>()

  function event(address = '127.0.0.1') {
    return {
      node: { req: { socket: { remoteAddress: address } } }
    } as unknown as H3Event
  }

  beforeAll(async () => {
    configureAppTestEnvironment(url!)
    const { resetEnv } = await import('../config/env')
    resetEnv()

    vi.stubGlobal('getHeader', () => undefined)
    vi.stubGlobal('setResponseHeader', (_event: H3Event, name: string, value: string | number) => {
      responseHeaders.set(name, String(value))
    })
    vi.stubGlobal('createError', (input: { statusCode: number, statusMessage: string }) => {
      return Object.assign(new Error(input.statusMessage), input)
    })
  })

  beforeEach(async () => {
    responseHeaders.clear()
    await sql`truncate table api_rate_limits`
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    await sql`truncate table api_rate_limits`
    await sql.end()
  })

  it('creates a bucket and atomically increments requests inside its window', async () => {
    const request = event()
    const options = { namespace: 'test', limit: 3, windowSeconds: 60 }

    await enforceRateLimit(request, options)
    await enforceRateLimit(request, options)

    const [bucket] = await sql<{ request_count: number, expires_in_future: boolean }[]>`
      select request_count, expires_at > now() as expires_in_future
      from api_rate_limits
    `
    expect(bucket).toEqual({ request_count: 2, expires_in_future: true })
    expect(responseHeaders.get('RateLimit-Limit')).toBe('3')
    expect(responseHeaders.get('RateLimit-Remaining')).toBe('1')
  })

  it('starts a fresh window when the existing bucket has expired', async () => {
    const request = event()
    const options = { namespace: 'test', limit: 3, windowSeconds: 60 }

    await enforceRateLimit(request, options)
    await sql`
      update api_rate_limits
      set request_count = 9,
          window_start = now() - interval '2 minutes',
          expires_at = now() - interval '1 minute'
    `

    await enforceRateLimit(request, options)

    const [bucket] = await sql<{ request_count: number, expires_in_future: boolean }[]>`
      select request_count, expires_at > now() as expires_in_future
      from api_rate_limits
    `
    expect(bucket).toEqual({ request_count: 1, expires_in_future: true })
    expect(responseHeaders.get('RateLimit-Remaining')).toBe('2')
  })

  it('rejects requests over the limit and includes retry guidance', async () => {
    const request = event()
    const options = { namespace: 'test', limit: 1, windowSeconds: 60 }

    await enforceRateLimit(request, options)

    await expect(enforceRateLimit(request, options)).rejects.toMatchObject({ statusCode: 429 })
    expect(Number(responseHeaders.get('Retry-After'))).toBeGreaterThan(0)
  })
})
