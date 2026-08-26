import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetEnv } from '../config/env'
import {
  verifyZoomWebhookSignature,
  zoomEndpointValidationResponse
} from './video/zoom-webhook'

describe('Zoom webhook verification', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://schedra:schedra@localhost:5442/schedra'
    process.env.SCHEDRA_URL = 'http://localhost:3002'
    process.env.AUTH_SECRET = 'x'.repeat(32)
    process.env.ZOOM_WEBHOOK_SECRET = 'zoom-webhook-secret'
    resetEnv()
  })

  it('accepts a signature over the exact raw request body', () => {
    const body = '{"event":"app_deauthorized","payload":{"user_id":"zoom-user"}}'
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = `v0=${createHmac('sha256', 'zoom-webhook-secret')
      .update(`v0:${timestamp}:${body}`)
      .digest('hex')}`

    expect(verifyZoomWebhookSignature(body, timestamp, signature)).toBe(true)
    expect(verifyZoomWebhookSignature(JSON.stringify(JSON.parse(body)), timestamp, signature)).toBe(true)
    expect(verifyZoomWebhookSignature(`${body}\n`, timestamp, signature)).toBe(false)
  })

  it('rejects stale, malformed and incorrectly signed requests', () => {
    const body = '{}'
    const stale = String(Math.floor(Date.now() / 1000) - 301)
    const staleSignature = `v0=${createHmac('sha256', 'zoom-webhook-secret')
      .update(`v0:${stale}:${body}`)
      .digest('hex')}`

    expect(verifyZoomWebhookSignature(body, stale, staleSignature)).toBe(false)
    expect(verifyZoomWebhookSignature(body, 'not-a-time', 'v0=bad')).toBe(false)
    expect(verifyZoomWebhookSignature(body, String(Math.floor(Date.now() / 1000)), 'v0=short')).toBe(false)
  })

  it('returns Zoom\'s challenge-response HMAC', () => {
    const response = zoomEndpointValidationResponse('plain-token')
    expect(response).toEqual({
      plainToken: 'plain-token',
      encryptedToken: createHmac('sha256', 'zoom-webhook-secret')
        .update('plain-token')
        .digest('hex')
    })
  })
})
