import { describe, expect, it } from 'vitest'
import { isRetryableEmailJob } from './operations'

describe('operations email recovery', () => {
  const now = new Date('2026-08-28T12:00:00.000Z')

  it('allows terminal and genuinely delayed email deliveries to be retried', () => {
    expect(isRetryableEmailJob('failed', now, now)).toBe(true)
    expect(isRetryableEmailJob('pending', new Date('2026-08-28T11:44:59.000Z'), now)).toBe(true)
    expect(isRetryableEmailJob('sending', new Date('2026-08-28T11:40:00.000Z'), now)).toBe(true)
  })

  it('does not expose retry while normal backoff or delivery is in progress', () => {
    expect(isRetryableEmailJob('pending', new Date('2026-08-28T11:55:00.000Z'), now)).toBe(false)
    expect(isRetryableEmailJob('sending', new Date('2026-08-28T11:59:00.000Z'), now)).toBe(false)
    expect(isRetryableEmailJob('sent', new Date('2026-08-28T11:00:00.000Z'), now)).toBe(false)
  })
})
