import { beforeEach, describe, expect, it } from 'vitest'
import { resetEnv } from './env'

describe('integration credential encryption', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/schedra_test'
    process.env.SCHEDRA_URL = 'http://localhost:3002'
    process.env.AUTH_SECRET = 'test-secret-that-is-longer-than-thirty-two-characters'
    delete process.env.INTEGRATION_ENCRYPTION_KEY
    resetEnv()
  })

  it('round-trips a credential without storing its plaintext', async () => {
    const { decryptCredential, encryptCredential } = await import('./credential-crypto')
    const secret = 'google-refresh-token-value'
    const encrypted = encryptCredential(secret)

    expect(encrypted).toMatch(/^v1\./)
    expect(encrypted).not.toContain(secret)
    expect(decryptCredential(encrypted)).toBe(secret)
  })

  it('rejects a modified authentication tag', async () => {
    const { decryptCredential, encryptCredential } = await import('./credential-crypto')
    const encrypted = encryptCredential('google-refresh-token-value')
    const parts = encrypted.split('.')
    parts[2] = `${parts[2]!.startsWith('A') ? 'B' : 'A'}${parts[2]!.slice(1)}`

    expect(() => decryptCredential(parts.join('.'))).toThrow()
  })

  it('derives a stable Google-compatible event id for retry-safe creation', async () => {
    const { googleEventId } = await import('./google-calendar')
    const first = googleEventId('booking-uid')

    expect(first).toBe(googleEventId('booking-uid'))
    expect(first).not.toBe(googleEventId('another-booking'))
    expect(first).toMatch(/^[a-v0-9]{5,1024}$/)
  })
})
