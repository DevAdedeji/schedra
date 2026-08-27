import { verifyWebhookSignature } from '../../integrations/bachs'
import { logEvent } from '../../observability/logger'
import {
  claimWebhookDelivery,
  completeWebhookDelivery,
  failWebhookDelivery
} from '../../services/webhook-delivery'
import { processBachsWebhook, type BachsEvent } from '../../services/webhooks/bachs'

export default defineEventHandler(async (event) => {
  const rawBody = await readRawBody(event, 'utf8')
  if (!rawBody) throw createError({ statusCode: 400, statusMessage: 'Empty webhook body' })

  if (!verifyWebhookSignature(
    rawBody,
    getHeader(event, 'x-bachs-timestamp'),
    getHeader(event, 'x-bachs-signature')
  )) {
    logEvent('warn', 'webhook_signature_rejected', { provider: 'bachs' }, event)
    throw createError({ statusCode: 401, statusMessage: 'Invalid webhook signature' })
  }

  let payload: BachsEvent
  try {
    payload = JSON.parse(rawBody)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Malformed webhook body' })
  }
  const eventId = payload.id
  const eventType = payload.type ?? 'unknown'
  if (!eventId) throw createError({ statusCode: 400, statusMessage: 'Webhook is missing an event id' })

  const claim = await claimWebhookDelivery({
    provider: 'bachs',
    providerEventId: eventId,
    eventType,
    rawBody,
    requestId: event.context.requestId
  })
  if (!claim.shouldProcess) {
    return { received: true, duplicate: true, status: claim.delivery.status }
  }

  try {
    const result = await processBachsWebhook(payload)
    await completeWebhookDelivery(claim.delivery.id, 'ignored' in result ? 'ignored' : 'completed')
    logEvent('info', 'webhook_processed', {
      provider: 'bachs',
      eventType,
      deliveryId: claim.delivery.id,
      duplicate: claim.duplicate
    }, event)
    return result
  } catch (error) {
    await failWebhookDelivery(claim.delivery.id, error)
    logEvent('error', 'webhook_processing_failed', {
      provider: 'bachs',
      eventType,
      deliveryId: claim.delivery.id,
      error
    }, event)
    throw createError({ statusCode: 500, statusMessage: 'Webhook processing failed' })
  }
})
