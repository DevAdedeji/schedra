export interface Env {
  databaseUrl: string
  schedraUrl: string
  authSecret: string
  integrationEncryptionKey?: string

  googleClientId?: string
  googleClientSecret?: string
  microsoftClientId?: string
  microsoftClientSecret?: string
  zoomClientId?: string
  zoomClientSecret?: string
  zoomWebhookSecret?: string

  bachsSecretKey?: string
  bachsWebhookSecret?: string

  resendApiKey?: string
  smtpUrl?: string
  emailDeliveryMode: 'resend' | 'smtp' | 'log'
  emailFrom: string
  platformAdminEmails: string[]
  operationsAlertEmails: string[]
  processRole: 'web' | 'worker' | 'all'
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

function emailList(name: string) {
  const values = (optional(name) ?? '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
  for (const value of values) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      throw new Error(`${name} contains an invalid email address.`)
    }
  }
  return [...new Set(values)]
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
  const microsoftClientId = optional('MICROSOFT_CLIENT_ID')
  const microsoftClientSecret = optional('MICROSOFT_CLIENT_SECRET')
  const zoomClientId = optional('ZOOM_CLIENT_ID')
  const zoomClientSecret = optional('ZOOM_CLIENT_SECRET')
  const zoomWebhookSecret = optional('ZOOM_WEBHOOK_SECRET')
  const integrationEncryptionKey = optional('INTEGRATION_ENCRYPTION_KEY')
  const bachsSecretKey = optional('BACHS_SECRET_KEY')
  const bachsWebhookSecret = optional('BACHS_WEBHOOK_SECRET')
  const resendApiKey = optional('RESEND_API_KEY')
  const smtpUrl = optional('SMTP_URL')
  const emailFrom = optional('EMAIL_FROM')
  const platformAdminEmails = emailList('PLATFORM_ADMIN_EMAILS')
  const operationsAlertEmails = emailList('OPERATIONS_ALERT_EMAILS')
  const processRole = optional('SCHEDRA_PROCESS_ROLE') ?? 'all'

  if (!['web', 'worker', 'all'].includes(processRole)) {
    throw new Error('SCHEDRA_PROCESS_ROLE must be web, worker or all.')
  }

  if (Boolean(googleClientId) !== Boolean(googleClientSecret)) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together.')
  }
  if (Boolean(microsoftClientId) !== Boolean(microsoftClientSecret)) {
    throw new Error('MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must be set together.')
  }
  if (Boolean(zoomClientId) !== Boolean(zoomClientSecret)) {
    throw new Error('ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET must be set together.')
  }
  if (integrationEncryptionKey && integrationEncryptionKey.length < 32) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY must be at least 32 characters.')
  }
  if (bachsSecretKey && !/^sk_(sandbox|live)_/.test(bachsSecretKey)) {
    throw new Error('BACHS_SECRET_KEY must start with sk_sandbox_ or sk_live_.')
  }
  // A checkout nobody can confirm is worse than no checkout: Bachs webhooks are
  // the only trustworthy signal that money actually arrived.
  if (bachsSecretKey && !bachsWebhookSecret) {
    throw new Error('BACHS_WEBHOOK_SECRET is required whenever BACHS_SECRET_KEY is set.')
  }

  const schedraUrl = parseUrl('SCHEDRA_URL', process.env.SCHEDRA_URL!, ['http:', 'https:'])
  const local = ['localhost', '127.0.0.1', '::1'].includes(new URL(schedraUrl).hostname)
  if (zoomClientId && !zoomWebhookSecret && !local) {
    throw new Error('ZOOM_WEBHOOK_SECRET is required whenever Zoom is configured outside local development.')
  }
  if (smtpUrl) parseUrl('SMTP_URL', smtpUrl, ['smtp:', 'smtps:'])
  if (!resendApiKey && !smtpUrl && !local) {
    throw new Error('Configure SMTP_URL or RESEND_API_KEY outside local development so account and booking emails are not lost.')
  }
  if (!emailFrom && !local) throw new Error('EMAIL_FROM is required outside local development.')

  cached = {
    databaseUrl: parseUrl('DATABASE_URL', process.env.DATABASE_URL!, ['postgres:', 'postgresql:']),
    schedraUrl,
    authSecret,
    integrationEncryptionKey,
    bachsSecretKey,
    bachsWebhookSecret,
    googleClientId,
    googleClientSecret,
    microsoftClientId,
    microsoftClientSecret,
    zoomClientId,
    zoomClientSecret,
    zoomWebhookSecret,
    resendApiKey,
    smtpUrl,
    emailDeliveryMode: smtpUrl ? 'smtp' : resendApiKey ? 'resend' : 'log',
    emailFrom: emailFrom ?? 'Schedra <onboarding@resend.dev>',
    platformAdminEmails,
    operationsAlertEmails: operationsAlertEmails.length ? operationsAlertEmails : platformAdminEmails,
    processRole: processRole as Env['processRole']
  }

  return cached
}

export function resetEnv() {
  cached = null
}
