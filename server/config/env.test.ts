import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetEnv, useEnv } from './env'

const keys = [
  'DATABASE_URL',
  'SCHEDRA_URL',
  'AUTH_SECRET',
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
})
