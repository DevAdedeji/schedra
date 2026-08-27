import { describe, expect, it } from 'vitest'
import { createOAuthPkce, matchesOAuthState, oauthCodeChallenge } from './oauth'

describe('OAuth request protection', () => {
  it('creates a high-entropy S256 verifier and challenge for every request', () => {
    const first = createOAuthPkce()
    const second = createOAuthPkce()

    expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first.challenge).toBe(oauthCodeChallenge(first.verifier))
    expect(first.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(second.verifier).not.toBe(first.verifier)
  })

  it('accepts only the exact state value', () => {
    expect(matchesOAuthState('expected-state', 'expected-state')).toBe(true)
    expect(matchesOAuthState('expected-state', 'different-state')).toBe(false)
    expect(matchesOAuthState('expected-state')).toBe(false)
  })
})
