import { createHash } from 'node:crypto'
import { z } from 'zod'
import { useEnv } from '../../config/env'
import { deauthorizeZoomUser } from '../zoom-connection'

const envelopeSchema = z.object({
  event: z.string().min(1),
  event_ts: z.number().optional(),
  payload: z.unknown()
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

export function zoomWebhookIdentity(body: unknown, rawBody: string) {
  const envelope = envelopeSchema.safeParse(body)
  if (!envelope.success) throw createError({ statusCode: 400, statusMessage: 'Malformed webhook event' })
  return {
    eventType: envelope.data.event,
    // Zoom timestamps are not unique: multiple events can be emitted in the
    // same millisecond. The signed raw body is stable across retries and
    // avoids silently deduplicating two legitimate events.
    eventId: `${envelope.data.event}:${createHash('sha256').update(rawBody).digest('hex')}`
  }
}

export async function processZoomWebhook(body: unknown) {
  const envelope = envelopeSchema.parse(body)
  if (envelope.event !== 'app_deauthorized') return { received: true, ignored: envelope.event }

  const deauthorization = deauthorizationSchema.safeParse(body)
  if (!deauthorization.success) throw new Error('Malformed Zoom deauthorization event.')
  if (deauthorization.data.payload.client_id !== useEnv().zoomClientId) {
    throw new Error('Zoom webhook client does not match this app.')
  }
  const result = await deauthorizeZoomUser(deauthorization.data.payload.user_id)
  return {
    received: true,
    removedConnections: result.removedConnections,
    removedMeetings: result.removedMeetings
  }
}
