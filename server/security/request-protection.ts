const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export const DEFAULT_API_BODY_BYTES = 64 * 1024
export const WEBHOOK_BODY_BYTES = 256 * 1024
export const AVATAR_BODY_BYTES = 2_250_000

interface RequestProtectionInput {
  pathname: string
  method: string
  contentLength?: string
  fetchSite?: string
  origin?: string
  expectedOrigin: string
  maxBodyBytes?: number
}

export interface SensitiveRateLimit {
  namespace: string
  limit: number
  windowSeconds: number
}

export function apiBodyLimit(pathname: string) {
  if (pathname === '/api/profile/avatar') return AVATAR_BODY_BYTES
  if (pathname.startsWith('/api/webhooks/')) return WEBHOOK_BODY_BYTES
  if (pathname.startsWith('/api/auth/')) return 16 * 1024
  return DEFAULT_API_BODY_BYTES
}

export function sensitiveRateLimit(pathname: string, method: string): SensitiveRateLimit | undefined {
  if (!UNSAFE_METHODS.has(method.toUpperCase())) return
  if (pathname === '/api/auth/sign-in/email') {
    return { namespace: 'auth-sign-in', limit: 10, windowSeconds: 10 * 60 }
  }
  if (pathname === '/api/auth/sign-up/email') {
    return { namespace: 'auth-sign-up', limit: 5, windowSeconds: 60 * 60 }
  }
  if (['/api/auth/request-password-reset', '/api/auth/send-verification-email'].includes(pathname)) {
    return { namespace: 'auth-email-recovery', limit: 5, windowSeconds: 10 * 60 }
  }
  if (pathname === '/api/account') {
    return { namespace: 'account-delete', limit: 3, windowSeconds: 60 * 60 }
  }
  if (pathname === '/api/integrations/retry') {
    return { namespace: 'integration-retry', limit: 10, windowSeconds: 10 * 60 }
  }
  if (pathname === '/api/operations/retry') {
    return { namespace: 'operations-retry', limit: 30, windowSeconds: 5 * 60 }
  }
}

export function requestProtectionFailure(input: RequestProtectionInput) {
  if (!input.pathname.startsWith('/api/') || !UNSAFE_METHODS.has(input.method.toUpperCase())) return

  const contentLength = Number(input.contentLength ?? 0)
  if (input.contentLength && (!Number.isFinite(contentLength) || contentLength < 0)) {
    return { statusCode: 400, statusMessage: 'Invalid Content-Length header.' }
  }
  if (contentLength > (input.maxBodyBytes ?? DEFAULT_API_BODY_BYTES)) {
    return { statusCode: 413, statusMessage: 'Request body is too large.' }
  }

  if (input.fetchSite?.toLowerCase() === 'cross-site') {
    return { statusCode: 403, statusMessage: 'Cross-site request blocked.' }
  }

  if (!input.origin) return

  try {
    if (new URL(input.origin).origin !== new URL(input.expectedOrigin).origin) {
      return { statusCode: 403, statusMessage: 'Request origin is not allowed.' }
    }
  } catch {
    return { statusCode: 403, statusMessage: 'Invalid request origin.' }
  }
}
