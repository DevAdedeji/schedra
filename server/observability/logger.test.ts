import { describe, expect, it } from 'vitest'
import { sanitizeLogFields } from './logger'

describe('structured log sanitization', () => {
  it('redacts secrets and masks email addresses recursively', () => {
    expect(sanitizeLogFields({
      accessToken: 'secret',
      attendeeEmail: 'ada@example.com',
      nested: { cookie: 'session', safe: 'ok' }
    })).toEqual({
      accessToken: '[redacted]',
      attendeeEmail: 'ad***@example.com',
      nested: { cookie: '[redacted]', safe: 'ok' }
    })
  })
})
