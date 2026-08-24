const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const MAX_API_BODY_BYTES = 64 * 1024

interface RequestProtectionInput {
  pathname: string
  method: string
  contentLength?: string
  fetchSite?: string
  origin?: string
  expectedOrigin: string
}

export function requestProtectionFailure(input: RequestProtectionInput) {
  if (!input.pathname.startsWith('/api/') || !UNSAFE_METHODS.has(input.method.toUpperCase())) return

  const contentLength = Number(input.contentLength ?? 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_API_BODY_BYTES) {
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
