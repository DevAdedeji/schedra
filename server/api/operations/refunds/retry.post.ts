import { z } from 'zod'
import { retryPaidBookingRefundByReference } from '../../../services/paid-booking'
import { recordSecurityAudit } from '../../../services/security-audit'
import { requirePlatformAdminSession } from '../../../services/session'

const bodySchema = z.object({
  paymentReference: z.string().trim().min(1).max(255)
})

export default defineEventHandler(async (event) => {
  const session = await requirePlatformAdminSession(event)
  const parsed = await readValidatedBody(event, bodySchema.safeParse)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Choose a valid refund to retry.' })

  const result = await retryPaidBookingRefundByReference(parsed.data.paymentReference)
  await recordSecurityAudit({
    action: 'operations.refund_retried',
    actorUserId: session.user.id,
    actorEmail: session.user.email,
    targetType: 'booking_payment',
    targetId: parsed.data.paymentReference,
    metadata: { providerState: result.providerState }
  }, event)
  return { retried: true, providerState: result.providerState }
})
