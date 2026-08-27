export type IntegrationProviderId = 'google' | 'microsoft' | 'zoom'

export interface IntegrationErrorOptions {
  provider: IntegrationProviderId
  retryable?: boolean
  retryAfterMs?: number
  cause?: unknown
}

/**
 * A provider failure with enough policy information for the durable worker to
 * decide whether it should retry automatically or wait for the user to act.
 */
export class IntegrationUnavailableError extends Error {
  readonly provider: IntegrationProviderId
  readonly retryable: boolean
  readonly retryAfterMs?: number

  constructor(message: string, options: IntegrationErrorOptions) {
    super(message, { cause: options.cause })
    this.name = 'IntegrationUnavailableError'
    this.provider = options.provider
    this.retryable = options.retryable ?? true
    this.retryAfterMs = options.retryAfterMs
  }
}

export function retryAfterMilliseconds(response: Response) {
  const value = response.headers.get('retry-after')?.trim()
  if (!value) return undefined

  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000)

  const date = Date.parse(value)
  if (!Number.isFinite(date)) return undefined
  return Math.max(0, date - Date.now())
}
