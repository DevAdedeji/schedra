export interface Env {
  databaseUrl: string
  schedraUrl: string
  authSecret: string

  googleClientId?: string
  googleClientSecret?: string

  resendApiKey?: string
  emailDeliveryMode: 'resend' | 'log'
  emailFrom: string
}

let cached: Env | null = null

function parseUrl(name: string, value: string, protocols: string[]) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} is not a valid URL: ${value}`)
  }

  if (!protocols.includes(url.protocol)) {
    throw new Error(`${name} must use ${protocols.join(' or ')} — got ${url.protocol}`)
  }

  return value
}

function optional(name: string) {
  const value = process.env[name]?.trim()
  return value || undefined
}

export function useEnv(): Env {
  if (cached) return cached

  const missing = (['DATABASE_URL', 'SCHEDRA_URL', 'AUTH_SECRET'] as const)
    .filter(key => !process.env[key])
  if (missing.length) {
    throw new Error(
      `Missing environment variables: ${missing.join(', ')}. Copy .env.example to .env.`
    )
  }

  const authSecret = process.env.AUTH_SECRET!
  if (authSecret.length < 32) {
    throw new Error('AUTH_SECRET must be at least 32 characters. Generate one with `openssl rand -base64 32`.')
  }

  const googleClientId = optional('GOOGLE_CLIENT_ID')
  const googleClientSecret = optional('GOOGLE_CLIENT_SECRET')
  const resendApiKey = optional('RESEND_API_KEY')

  if (Boolean(googleClientId) !== Boolean(googleClientSecret)) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together.')
  }

  const schedraUrl = parseUrl('SCHEDRA_URL', process.env.SCHEDRA_URL!, ['http:', 'https:'])
  if (!resendApiKey && !['localhost', '127.0.0.1', '::1'].includes(new URL(schedraUrl).hostname)) {
    throw new Error('RESEND_API_KEY is required outside local development so account and booking emails are not lost.')
  }

  cached = {
    databaseUrl: parseUrl('DATABASE_URL', process.env.DATABASE_URL!, ['postgres:', 'postgresql:']),
    schedraUrl,
    authSecret,
    googleClientId,
    googleClientSecret,
    resendApiKey,
    emailDeliveryMode: resendApiKey ? 'resend' : 'log',
    emailFrom: optional('EMAIL_FROM') ?? 'Schedra <onboarding@resend.dev>'
  }

  return cached
}

export function resetEnv() {
  cached = null
}
