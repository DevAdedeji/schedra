import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'
import { lt, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { apiRateLimits } from '../database/schema'
import { useDatabase } from './database'
import { useEnv } from './env'

interface RateLimitOptions {
  namespace: string
  limit: number
  windowSeconds: number
  identity?: string
}

let lastPruneAt = 0

function clientAddress(event: H3Event) {
  const realIp = getHeader(event, 'x-real-ip')?.trim()
  if (realIp && isIP(realIp)) return realIp

  return event.node.req.socket.remoteAddress ?? 'unknown'
}

export async function enforceRateLimit(event: H3Event, options: RateLimitOptions) {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + options.windowSeconds * 1000)
  const source = [options.namespace, options.identity ?? '', clientAddress(event)].join(':')
  const key = createHmac('sha256', useEnv().authSecret).update(source).digest('hex')

  const [bucket] = await useDatabase()
    .insert(apiRateLimits)
    .values({ key, windowStart: now, requestCount: 1, expiresAt })
    .onConflictDoUpdate({
      target: apiRateLimits.key,
      set: {
        requestCount: sql`case when ${apiRateLimits.expiresAt} <= ${now} then 1 else ${apiRateLimits.requestCount} + 1 end`,
        windowStart: sql`case when ${apiRateLimits.expiresAt} <= ${now} then ${now} else ${apiRateLimits.windowStart} end`,
        expiresAt: sql`case when ${apiRateLimits.expiresAt} <= ${now} then ${expiresAt} else ${apiRateLimits.expiresAt} end`
      }
    })
    .returning({ requestCount: apiRateLimits.requestCount, expiresAt: apiRateLimits.expiresAt })

  if (!bucket) {
    throw createError({ statusCode: 503, statusMessage: 'Request protection is temporarily unavailable.' })
  }

  const resetAt = Math.ceil(bucket.expiresAt.getTime() / 1000)
  const remaining = Math.max(0, options.limit - bucket.requestCount)
  setResponseHeader(event, 'RateLimit-Limit', String(options.limit))
  setResponseHeader(event, 'RateLimit-Remaining', String(remaining))
  setResponseHeader(event, 'RateLimit-Reset', String(resetAt))

  if (now.getTime() - lastPruneAt > 300_000) {
    lastPruneAt = now.getTime()
    await useDatabase().delete(apiRateLimits).where(lt(apiRateLimits.expiresAt, now))
  }

  if (bucket.requestCount > options.limit) {
    setResponseHeader(event, 'Retry-After', Math.max(1, resetAt - Math.floor(now.getTime() / 1000)))
    throw createError({ statusCode: 429, statusMessage: 'Too many requests. Please try again shortly.' })
  }
}
