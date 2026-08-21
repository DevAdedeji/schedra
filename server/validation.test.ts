import { describe, expect, it } from 'vitest'
import {
  accountProfileSchema,
  emailSchema,
  passwordSchema,
  timeZoneSchema
} from '../shared/validation'

describe('authentication validation', () => {
  it('normalizes email addresses', () => {
    expect(emailSchema.parse('  ADA@EXAMPLE.COM ')).toBe('ada@example.com')
  })

  it('keeps the client password limit aligned at 200 characters', () => {
    expect(passwordSchema.safeParse('a'.repeat(200)).success).toBe(true)
    expect(passwordSchema.safeParse('a'.repeat(201)).success).toBe(false)
  })

  it('accepts real IANA time zones and rejects invented ones', () => {
    expect(timeZoneSchema.safeParse('Africa/Lagos').success).toBe(true)
    expect(timeZoneSchema.safeParse('Somewhere/Imaginary').success).toBe(false)
  })

  it('applies profile limits outside the browser form', () => {
    const profile = {
      name: 'a'.repeat(81),
      username: 'ada',
      email: 'ada@example.com',
      timeZone: 'Africa/Lagos'
    }

    expect(accountProfileSchema.safeParse(profile).success).toBe(false)
  })
})
