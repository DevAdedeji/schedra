import { createHash } from 'node:crypto'

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024
export const AVATAR_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export function validAvatarBytes(contentType: string, bytes: Uint8Array) {
  if (contentType === 'image/png') {
    return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
  }
  if (contentType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
  if (contentType === 'image/webp') {
    return Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF'
      && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
  }
  return false
}

export function avatarHash(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}
