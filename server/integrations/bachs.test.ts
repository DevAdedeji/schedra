import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { toDecimalString, fromDecimalString, billableSeats, invoiceTotalCents } from '#shared/billing'

const SECRET = 'whsec-test-secret'

function sign(body: string, timestamp: number, secret = SECRET) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex')
}

describe('bachs webhook signatures', () => {
  let verify: typeof import('./bachs').verifyWebhookSignature

  beforeEach(async () => {
    process.env.DATABASE_URL ||= 'postgres://localhost:5432/schedra_test'
    process.env.SCHEDRA_URL ||= 'http://localhost:3002'
    process.env.AUTH_SECRET ||= 'x'.repeat(32)
    process.env.BACHS_SECRET_KEY = 'sk_sandbox_test'
    process.env.BACHS_WEBHOOK_SECRET = SECRET

    const { resetEnv } = await import('../config/env')
    resetEnv()
    verify = (await import('./bachs')).verifyWebhookSignature
  })

  afterEach(async () => {
    delete process.env.BACHS_SECRET_KEY
    delete process.env.BACHS_WEBHOOK_SECRET
    const { resetEnv } = await import('../config/env')
    resetEnv()
  })

  it('accepts a signature over the exact raw body', () => {
    const body = '{"id":"evt_1","type":"collection.succeeded"}'
    const timestamp = Math.floor(Date.now() / 1000)

    expect(verify(body, String(timestamp), sign(body, timestamp))).toBe(true)
  })

  it('rejects a body that was re-serialised after parsing', () => {
    const body = '{"id":"evt_1","type":"collection.succeeded"}'
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = sign(body, timestamp)

    // Same data, different bytes — this is the mistake the guide warns about.
    const reserialised = JSON.stringify(JSON.parse(body), null, 2)
    expect(verify(reserialised, String(timestamp), signature)).toBe(false)
  })

  it('rejects a replayed delivery outside the tolerance window', () => {
    const body = '{"id":"evt_1"}'
    const stale = Math.floor(Date.now() / 1000) - 600

    expect(verify(body, String(stale), sign(body, stale))).toBe(false)
  })

  it('rejects a signature made with the wrong secret', () => {
    const body = '{"id":"evt_1"}'
    const timestamp = Math.floor(Date.now() / 1000)

    expect(verify(body, String(timestamp), sign(body, timestamp, 'not-the-secret'))).toBe(false)
  })

  it('rejects missing headers and malformed timestamps without throwing', () => {
    const body = '{"id":"evt_1"}'
    const timestamp = Math.floor(Date.now() / 1000)

    expect(verify(body, undefined, sign(body, timestamp))).toBe(false)
    expect(verify(body, String(timestamp), undefined)).toBe(false)
    expect(verify(body, 'not-a-number', sign(body, timestamp))).toBe(false)
    // A short signature would make timingSafeEqual throw if lengths were not
    // compared first.
    expect(verify(body, String(timestamp), 'abc')).toBe(false)
  })
})

describe('money at the bachs boundary', () => {
  it('renders cents as a fixed two-decimal string', () => {
    expect(toDecimalString(1600)).toBe('16.00')
    expect(toDecimalString(8000)).toBe('80.00')
    expect(toDecimalString(1)).toBe('0.01')
  })

  it('round-trips without float drift', () => {
    for (const cents of [1600, 8000, 12345, 99999]) {
      expect(fromDecimalString(toDecimalString(cents))).toBe(cents)
    }
  })

  it('reads a settlement amount that differs from the charge', () => {
    expect(fromDecimalString('74250.00')).toBe(7425000)
    expect(fromDecimalString(null)).toBe(0)
    expect(fromDecimalString(undefined)).toBe(0)
    expect(fromDecimalString('not-a-number')).toBe(0)
  })

  it('never bills below the two-seat minimum', () => {
    expect(billableSeats(0)).toBe(2)
    expect(billableSeats(1)).toBe(2)
    expect(billableSeats(5)).toBe(5)
    expect(invoiceTotalCents(1, 'monthly')).toBe(1600)
    expect(invoiceTotalCents(3, 'yearly')).toBe(24000)
  })
})
