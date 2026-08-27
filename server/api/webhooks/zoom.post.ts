import { z } from 'zod'
import {
  verifyZoomWebhookSignature,
  zoomEndpointValidationResponse
} from '../../integrations/video/zoom-webhook'
import { logEvent } from '../../observability/logger'
import {
  claimWebhookDelivery,
  completeWebhookDelivery,
  failWebhookDelivery
} from '../../services/webhook-delivery'
import { processZoomWebhook, zoomWebhookIdentity } from '../../services/webhooks/zoom'

const validationSchema = z.object({
  event: z.literal('endpoint.url_validation'),
  payload: z.object({ plainToken: z.string().min(1).max(500) })
})

export default defineEventHandler(async (event) => {
  const rawBody = await readRawBody(event, 'utf8')
  if (!rawBody) throw createError({ statusCode: 400, statusMessage: 'Empty webhook body' })

  if (!verifyZoomWebhookSignature(
    rawBody,
    getHeader(event, 'x-zm-request-timestamp'),
    getHeader(event, 'x-zm-signature')
  )) {
    logEvent('warn', 'webhook_signature_rejected', { provider: 'zoom' }, event)
    throw createError({ statusCode: 401, statusMessage: 'Invalid webhook signature' })
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Malformed webhook body' })
  }

  const validation = validationSchema.safeParse(body)
  if (validation.success) {
    return zoomEndpointValidationResponse(validation.data.payload.plainToken)
  }

  const identity = zoomWebhookIdentity(body, rawBody)
  const claim = await claimWebhookDelivery({
    provider: 'zoom',
    providerEventId: identity.eventId,
    eventType: identity.eventType,
    rawBody,
    requestId: event.context.requestId
  })
  if (!claim.shouldProcess) {
    return { received: true, duplicate: true, status: claim.delivery.status }
  }

  try {
    const result = await processZoomWebhook(body)
    await completeWebhookDelivery(claim.delivery.id, 'ignored' in result ? 'ignored' : 'completed')
    logEvent('info', 'webhook_processed', {
      provider: 'zoom',
      eventType: identity.eventType,
      deliveryId: claim.delivery.id,
      duplicate: claim.duplicate
    }, event)
    return result
  } catch (error) {
    await failWebhookDelivery(claim.delivery.id, error)
    logEvent('error', 'webhook_processing_failed', {
      provider: 'zoom',
      eventType: identity.eventType,
      deliveryId: claim.delivery.id,
      error
    }, event)
    throw createError({ statusCode: 500, statusMessage: 'Webhook processing failed' })
  }
})
