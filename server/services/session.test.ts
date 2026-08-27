import { describe, expect, it } from 'vitest'
import { isPlatformAdminEmail } from './session'

describe('platform administrator allow-list', () => {
  it('matches normalized email addresses only', () => {
    expect(isPlatformAdminEmail(' Admin@Schedra.xyz ', ['admin@schedra.xyz'])).toBe(true)
    expect(isPlatformAdminEmail('member@schedra.xyz', ['admin@schedra.xyz'])).toBe(false)
  })
})
