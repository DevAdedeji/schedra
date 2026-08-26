import { z } from 'zod'
import { useEnv } from '../../config/env'
import {
  verifyZoomWebhookSignature,
  zoomEndpointValidationResponse
} from '../../integrations/video/zoom-webhook'
import { deauthorizeZoomUser } from '../../services/zoom-connection'

const envelopeSchema = z.object({
  event: z.string().min(1),
  payload: z.unknown()
})

const validationSchema = z.object({
  event: z.literal('endpoint.url_validation'),
  payload: z.object({ plainToken: z.string().min(1).max(500) })
})

const deauthorizationSchema = z.object({
  event: z.literal('app_deauthorized'),
  payload: z.object({
    account_id: z.string().min(1),
    user_id: z.string().min(1),
    client_id: z.string().min(1),
    deauthorization_time: z.string().min(1),
    signature: z.string().optional(),
    event_ts: z.number().optional()
  })
})

export default defineEventHandler(async (event) => {
  const rawBody = await readRawBody(event, 'utf8')
  if (!rawBody) throw createError({ statusCode: 400, statusMessage: 'Empty webhook body' })

  if (!verifyZoomWebhookSignature(
    rawBody,
    getHeader(event, 'x-zm-request-timestamp'),
    getHeader(event, 'x-zm-signature')
  )) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid webhook signature' })
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Malformed webhook body' })
  }

  const envelope = envelopeSchema.safeParse(body)
  if (!envelope.success) {
    throw createError({ statusCode: 400, statusMessage: 'Malformed webhook event' })
  }

  if (envelope.data.event === 'endpoint.url_validation') {
    const validation = validationSchema.safeParse(body)
    if (!validation.success) {
      throw createError({ statusCode: 400, statusMessage: 'Malformed validation request' })
    }
    return zoomEndpointValidationResponse(validation.data.payload.plainToken)
  }

  if (envelope.data.event !== 'app_deauthorized') {
    return { received: true, ignored: envelope.data.event }
  }

  const deauthorization = deauthorizationSchema.safeParse(body)
  if (!deauthorization.success) {
    throw createError({ statusCode: 400, statusMessage: 'Malformed deauthorization event' })
  }
  if (deauthorization.data.payload.client_id !== useEnv().zoomClientId) {
    throw createError({ statusCode: 401, statusMessage: 'Webhook client does not match this app' })
  }

  const result = await deauthorizeZoomUser(deauthorization.data.payload.user_id)
  console.info(JSON.stringify({
    event: 'zoom_deauthorization_processed',
    removedConnections: result.removedConnections,
    removedMeetings: result.removedMeetings
  }))

  return { received: true }
})
