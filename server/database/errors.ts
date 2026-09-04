/** Drizzle wraps provider errors; inspect codes without exposing query parameters. */
export function databaseErrorCode(error: unknown): string | undefined {
  const seen = new Set<unknown>()
  let current = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    const value = current as { code?: unknown, cause?: unknown }
    if (typeof value.code === 'string') return value.code
    current = value.cause
  }
  return undefined
}
