import { z } from 'zod'
import { emailSchema } from '../../shared/validation'
import { enforceRateLimit } from '../services/rate-limit'
import { resendVerificationEmail } from '../services/verification-email'

const callbackURLSchema = z.string().trim().max(1000).refine(
  value => /^\/(?!\/)[^\\\r\n]*$/.test(value),
  'Choose a valid return page.'
)
const bodySchema = z.object({
  email: emailSchema,
  callbackURL: callbackURLSchema
})

export default defineEventHandler(async (event) => {
  const parsed = await readValidatedBody(event, bodySchema.safeParse)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Enter a valid email address.' })
  }

  await enforceRateLimit(event, {
    namespace: 'resend-verification',
    identity: parsed.data.email,
    limit: 5,
    windowSeconds: 10 * 60
  })
  await resendVerificationEmail(parsed.data.email, parsed.data.callbackURL)

  // Keep the response identical for missing, verified and unverified users.
  return { status: true }
})
