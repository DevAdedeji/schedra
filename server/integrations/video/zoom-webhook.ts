import { createHmac, timingSafeEqual } from 'node:crypto'
import { useEnv } from '../../config/env'

const WEBHOOK_TOLERANCE_SECONDS = 5 * 60

function safelyEqual(left: string, right: string) {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Zoom signs the exact request bytes as `v0:{timestamp}:{rawBody}`. Keep this
 * separate from JSON parsing so whitespace and property order cannot weaken or
 * accidentally break verification.
 */
export function verifyZoomWebhookSignature(
  rawBody: string,
  timestampHeader?: string,
  signatureHeader?: string
) {
  const secret = useEnv().zoomWebhookSecret
  if (!secret || !timestampHeader || !signatureHeader) return false

  const timestamp = Number.parseInt(timestampHeader, 10)
  if (!Number.isFinite(timestamp)) return false
  if (Math.abs(Date.now() / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false

  const digest = createHmac('sha256', secret)
    .update(`v0:${timestampHeader}:${rawBody}`, 'utf8')
    .digest('hex')

  return safelyEqual(`v0=${digest}`, signatureHeader)
}

export function zoomEndpointValidationResponse(plainToken: string) {
  const secret = useEnv().zoomWebhookSecret
  if (!secret) throw new Error('Zoom webhook verification is not configured.')

  return {
    plainToken,
    encryptedToken: createHmac('sha256', secret).update(plainToken, 'utf8').digest('hex')
  }
}
