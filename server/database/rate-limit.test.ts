import type { H3Event } from 'h3'
import postgres from 'postgres'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureAppTestEnvironment, getTestDatabaseUrl } from '../../test/helpers/database'

const url = getTestDatabaseUrl()

describe.skipIf(!url)('API rate limiter', () => {
  const sql = postgres(url!, { max: 2, onnotice: () => {} })

  function event(address = '127.0.0.1') {
    const headers = new Map<string, string | number>()
    return {
      headers,
      value: {
        node: {
          req: { headers: {}, socket: { remoteAddress: address } },
          res: { setHeader: (name: string, value: string | number) => headers.set(name, value) }
        }
      } as unknown as H3Event
    }
  }

  beforeEach(async () => {
    configureAppTestEnvironment(url!)
    const { resetEnv } = await import('../utils/env')
    resetEnv()
    await sql`truncate table api_rate_limits`
    vi.stubGlobal('getHeader', (request: H3Event, name: string) => request.node.req.headers[name.toLowerCase()])
    vi.stubGlobal('setResponseHeader', (request: H3Event, name: string, value: string | number) => {
      request.node.res.setHeader(name, value)
    })
    vi.stubGlobal('createError', (input: { statusCode: number, statusMessage: string }) => {
      return Object.assign(new Error(input.statusMessage), input)
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    await sql`truncate table api_rate_limits`
    await sql.end()
  })

  it('increments a database-clock window and returns rate-limit headers', async () => {
    const request = event()
    const { enforceRateLimit } = await import('../utils/rate-limit')

    await enforceRateLimit(request.value, { namespace: 'public-page', limit: 2, windowSeconds: 60 })
    await enforceRateLimit(request.value, { namespace: 'public-page', limit: 2, windowSeconds: 60 })

    const [bucket] = await sql<{ request_count: number, valid_window: boolean }[]>`
      select request_count, expires_at > window_start as valid_window from api_rate_limits
    `
    expect(bucket).toMatchObject({ request_count: 2, valid_window: true })
    expect(request.headers.get('RateLimit-Limit')).toBe('2')
    expect(request.headers.get('RateLimit-Remaining')).toBe('0')
  })

  it('resets an expired window and rejects requests over the limit', async () => {
    const request = event()
    const { enforceRateLimit } = await import('../utils/rate-limit')
    const options = { namespace: 'booking', limit: 1, windowSeconds: 60 }

    await enforceRateLimit(request.value, options)
    await expect(enforceRateLimit(request.value, options)).rejects.toMatchObject({ statusCode: 429 })
    expect(Number(request.headers.get('Retry-After'))).toBeGreaterThan(0)

    await sql`update api_rate_limits set expires_at = now() - interval '1 second'`
    await enforceRateLimit(request.value, options)

    const [bucket] = await sql<{ request_count: number }[]>`
      select request_count from api_rate_limits
    `
    expect(bucket?.request_count).toBe(1)
    expect(request.headers.get('RateLimit-Remaining')).toBe('0')
  })
})
