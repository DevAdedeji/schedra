import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { createEmailVerificationToken } from 'better-auth/api'
import { users } from '../database/schema'
import { useDatabase } from '../database'
import { useEnv } from '../config/env'
import { emailDedupeKey, enqueueEmails } from './email-outbox'

const VERIFICATION_LIFETIME_SECONDS = 24 * 60 * 60

export async function queueVerificationEmail(user: { email: string }, url: string) {
  await enqueueEmails([{
    dedupeKey: emailDedupeKey('email-verification', url),
    email: {
      to: user.email,
      subject: 'Confirm your email for Schedra',
      preheader: 'Confirm your email address and finish setting up your booking page.',
      heading: 'Confirm your email',
      body: 'You are one step away from sharing your Schedra booking page. Confirm your email address to finish setting up your account.',
      action: { label: 'Confirm my email', url },
      footer: 'This link expires in 24 hours. If you did not create a Schedra account, you can safely ignore this email.'
    }
  }])
}

/**
 * Queue a fresh verification message for a real, unverified account. The
 * caller deliberately receives no account-state details so this cannot be
 * used to discover which addresses are registered.
 */
export async function resendVerificationEmail(email: string, callbackURL: string) {
  const [user] = await useDatabase().select({
    email: users.email,
    emailVerified: users.emailVerified
  }).from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`).limit(1)

  if (!user || user.emailVerified) return false

  const env = useEnv()
  const token = await createEmailVerificationToken(
    env.authSecret,
    user.email,
    undefined,
    VERIFICATION_LIFETIME_SECONDS,
    // A resend must always create a distinct outbox job, including two
    // requests made within the same second.
    { resendId: randomUUID() }
  )
  const url = new URL('/api/auth/verify-email', env.schedraUrl)
  url.searchParams.set('token', token)
  url.searchParams.set('callbackURL', callbackURL)
  await queueVerificationEmail(user, url.toString())
  return true
}
