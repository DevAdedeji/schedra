import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export function oauthCodeChallenge(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url')
}

export function createOAuthPkce() {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: oauthCodeChallenge(verifier) }
}

export function matchesOAuthState(received: string, expected?: string) {
  if (!expected) return false
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}
