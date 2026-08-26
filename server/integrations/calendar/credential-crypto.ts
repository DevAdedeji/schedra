import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { useEnv } from '../../config/env'

const VERSION = 'v1'

function key() {
  const env = useEnv()
  return createHash('sha256').update(`schedra:integrations:${env.integrationEncryptionKey ?? env.authSecret}`).digest()
}

export function encryptCredential(value: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
}

export function decryptCredential(value: string) {
  const [version, iv, tag, encrypted] = value.split('.')
  if (version !== VERSION || !iv || !tag || !encrypted) throw new Error('Unsupported encrypted credential')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8')
}
