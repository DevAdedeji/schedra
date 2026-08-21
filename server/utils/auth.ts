import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { accountProfileSchema } from '../../shared/validation'
import * as schema from '../database/schema'
import { useDatabase } from './database'
import { sendEmail } from './email'
import { useEnv } from './env'

function createAuth() {
  const env = useEnv()

  return betterAuth({
    baseURL: env.schedraUrl,
    secret: env.authSecret,

    database: drizzleAdapter(useDatabase(), {
      provider: 'pg',
      schema,
      usePlural: true
    }),

    session: {
      cookieCache: { enabled: true, maxAge: 5 * 60 }
    },

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 200,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: 'Reset your Schedra password',
          heading: 'Reset your password',
          body: 'Click below to choose a new one. The link works once and expires in an hour.',
          action: { label: 'Choose a new password', url },
          footer: 'If you did not ask for this, you can ignore it — nothing has changed.'
        })
      }
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: 'Confirm your email for Schedra',
          heading: 'Confirm your email',
          body: 'One click and your booking link is live.',
          action: { label: 'Confirm my email', url },
          footer: 'If you did not sign up for Schedra, you can ignore this.'
        })
      }
    },

    socialProviders: env.googleClientId && env.googleClientSecret
      ? {
          google: {
            clientId: env.googleClientId,
            clientSecret: env.googleClientSecret
          }
        }
      : {},

    user: {
      fields: { image: 'avatarUrl' },
      additionalFields: {
        username: { type: 'string', required: false, input: true },
        timeZone: { type: 'string', required: false, input: true }
      }
    },

    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const record = user as typeof user & {
              username?: string | null
              timeZone?: string | null
            }
            const username = record.username
              || await deriveUsername(record.name ?? record.email)
            const parsed = accountProfileSchema.safeParse({
              name: record.name,
              email: record.email,
              username,
              ...(record.timeZone ? { timeZone: record.timeZone } : {})
            })

            if (!parsed.success) {
              throw new APIError('BAD_REQUEST', {
                code: 'INVALID_USER_PROFILE',
                message: parsed.error.issues[0]?.message ?? 'Those account details are not valid.'
              })
            }

            return { data: { ...user, ...parsed.data } }
          }
        }
      }
    },

    advanced: {
      database: {
        generateId: () => crypto.randomUUID()
      }
    }
  })
}

async function deriveUsername(seed: string) {
  const { sql } = await import('drizzle-orm')
  const { users } = schema
  const db = useDatabase()

  const base = seed
    .toLowerCase()
    .replace(/@.*$/, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24) || 'user'

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`
    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.username}) = ${candidate}`)
      .limit(1)

    if (!taken) return candidate
  }

  return `${base}-${crypto.randomUUID().slice(0, 8)}`
}

let cached: ReturnType<typeof createAuth> | null = null

export function useAuth() {
  cached ??= createAuth()
  return cached
}
