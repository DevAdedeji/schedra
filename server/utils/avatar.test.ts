import { describe, expect, it } from 'vitest'
import { avatarHash, MAX_AVATAR_BYTES, validAvatarBytes } from './avatar'

describe('avatar validation', () => {
  it('accepts supported image signatures and rejects disguised files', () => {
    expect(validAvatarBytes('image/png', Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true)
    expect(validAvatarBytes('image/webp', Buffer.from('RIFF0000WEBP'))).toBe(true)
    expect(validAvatarBytes('image/jpeg', Uint8Array.from([0xff, 0xd8, 0x00, 0xff, 0xd9]))).toBe(true)
    expect(validAvatarBytes('image/png', Buffer.from('<svg></svg>'))).toBe(false)
  })

  it('uses stable content hashes and a strict upload limit', () => {
    expect(avatarHash(Buffer.from('same'))).toBe(avatarHash(Buffer.from('same')))
    expect(avatarHash(Buffer.from('same'))).not.toBe(avatarHash(Buffer.from('different')))
    expect(MAX_AVATAR_BYTES).toBe(2_097_152)
  })
})
