import type { H3Event } from 'h3'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type LogFields = Record<string, unknown>

const SECRET_KEY = /(authorization|cookie|token|secret|password|credential|signature|payload|body)/i
const EMAIL_KEY = /(email|recipient)/i

function safeValue(key: string, value: unknown): unknown {
  if (SECRET_KEY.test(key)) return '[redacted]'
  if (EMAIL_KEY.test(key) && typeof value === 'string') {
    const [local, domain] = value.split('@')
    return domain ? `${local?.slice(0, 2) ?? ''}***@${domain}` : '[redacted]'
  }
  if (value instanceof Error) return { name: value.name, message: value.message.slice(0, 500) }
  if (Array.isArray(value)) return value.slice(0, 25).map(item => safeValue(key, item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as LogFields).map(([nestedKey, nested]) => [nestedKey, safeValue(nestedKey, nested)]))
  }
  if (typeof value === 'string') return value.slice(0, 1000)
  return value
}

export function sanitizeLogFields(fields: LogFields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, safeValue(key, value)]))
}

export function logEvent(level: LogLevel, name: string, fields: LogFields = {}, event?: H3Event) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event: name,
    service: 'schedra',
    environment: process.env.NODE_ENV ?? 'development',
    ...(event?.context.requestId ? { requestId: event.context.requestId } : {}),
    ...sanitizeLogFields(fields)
  }
  const line = JSON.stringify(entry)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.info(line)
}
