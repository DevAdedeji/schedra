import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetEnv, useEnv } from './env'

const keys = [
  'DATABASE_URL',
  'SCHEDRA_URL',
  'AUTH_SECRET',
  'SCHEDRA_ENVIRONMENT',
  'INTEGRATION_ENCRYPTION_KEY',
  'BACHS_SECRET_KEY',
  'BACHS_WEBHOOK_SECRET',
  'PLATFORM_ADMIN_EMAILS',
  'DATABASE_POOL_MAX',
  'SMTP_URL',
  'RESEND_API_KEY',
  'EMAIL_FROM'
] as const

describe('environment validation', () => {
  const original = new Map<string, string | undefined>()

  beforeEach(() => {
    for (const key of keys) original.set(key, process.env[key])
    process.env.DATABASE_URL = 'postgres://schedra:schedra@localhost:5442/schedra'
    process.env.SCHEDRA_URL = 'http://localhost:3002'
    process.env.AUTH_SECRET = 'test-secret-that-is-longer-than-thirty-two-characters'
    delete process.env.SMTP_URL
    delete process.env.RESEND_API_KEY
    delete process.env.EMAIL_FROM
    delete process.env.SCHEDRA_ENVIRONMENT
    delete process.env.INTEGRATION_ENCRYPTION_KEY
    delete process.env.BACHS_SECRET_KEY
    delete process.env.BACHS_WEBHOOK_SECRET
    delete process.env.PLATFORM_ADMIN_EMAILS
    delete process.env.DATABASE_POOL_MAX
    resetEnv()
  })

  afterEach(() => {
    for (const key of keys) {
      const value = original.get(key)
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
    original.clear()
    resetEnv()
  })

  it('does not include a rejected secret URL in its error message', () => {
    process.env.DATABASE_URL = 'not-a-url-with-a-database-password'

    expect(() => useEnv()).toThrow('DATABASE_URL is not a valid URL.')
    expect(() => useEnv()).not.toThrow(/database-password/)
  })

  it('requires HTTPS and independent credential encryption in production', () => {
    process.env.SCHEDRA_ENVIRONMENT = 'production'
    expect(() => useEnv()).toThrow('Production SCHEDRA_URL must use HTTPS.')

    resetEnv()
    process.env.SCHEDRA_URL = 'https://schedra.example'
    expect(() => useEnv()).toThrow('INTEGRATION_ENCRYPTION_KEY is required in production')
  })

  it('rejects sandbox payment credentials in production', () => {
    process.env.SCHEDRA_ENVIRONMENT = 'production'
    process.env.SCHEDRA_URL = 'https://schedra.example'
    process.env.INTEGRATION_ENCRYPTION_KEY = 'separate-encryption-key-that-is-long-enough'
    process.env.BACHS_SECRET_KEY = 'sk_sandbox_example'
    process.env.BACHS_WEBHOOK_SECRET = 'whsec_example'
    process.env.PLATFORM_ADMIN_EMAILS = 'admin@schedra.example'

    expect(() => useEnv()).toThrow('Production requires a BACHS_SECRET_KEY beginning with sk_live_.')
  })

  it('accepts a fully configured production environment', () => {
    process.env.SCHEDRA_ENVIRONMENT = 'production'
    process.env.SCHEDRA_URL = 'https://schedra.example'
    process.env.INTEGRATION_ENCRYPTION_KEY = 'separate-encryption-key-that-is-long-enough'
    process.env.BACHS_SECRET_KEY = 'sk_live_example'
    process.env.BACHS_WEBHOOK_SECRET = 'whsec_example'
    process.env.PLATFORM_ADMIN_EMAILS = 'admin@schedra.example'
    process.env.RESEND_API_KEY = 're_example'
    process.env.EMAIL_FROM = 'Schedra <hello@schedra.example>'

    expect(useEnv().environment).toBe('production')
  })

  it('keeps sandbox payment credentials valid on staging', () => {
    process.env.SCHEDRA_URL = 'https://staging.schedra.example'
    process.env.BACHS_SECRET_KEY = 'sk_sandbox_example'
    process.env.BACHS_WEBHOOK_SECRET = 'whsec_example'
    process.env.RESEND_API_KEY = 're_example'
    process.env.EMAIL_FROM = 'Schedra <hello@schedra.example>'

    expect(useEnv().environment).toBe('staging')
  })

  it('validates and exposes database connection budgets', () => {
    process.env.DATABASE_POOL_MAX = '7'
    expect(useEnv().databasePoolMax).toBe(7)

    resetEnv()
    process.env.DATABASE_POOL_MAX = '0'
    expect(() => useEnv()).toThrow('DATABASE_POOL_MAX must be an integer between 1 and 50.')

    resetEnv()
    process.env.DATABASE_POOL_MAX = '7workers'
    expect(() => useEnv()).toThrow('DATABASE_POOL_MAX must be an integer between 1 and 50.')
  })
})
