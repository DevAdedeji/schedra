export interface Env {
  databaseUrl: string
  schedraUrl: string
}

let cached: Env | null = null

function parseUrl(name: string, value: string, protocols: string[]) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} is not a valid URL: ${value}`)
  }

  if (!protocols.includes(url.protocol)) {
    throw new Error(`${name} must use ${protocols.join(' or ')} — got ${url.protocol}`)
  }

  return value
}

export function useEnv(): Env {
  if (cached) return cached

  const missing = (['DATABASE_URL', 'SCHEDRA_URL'] as const).filter(key => !process.env[key])
  if (missing.length) {
    throw new Error(
      `Missing environment variables: ${missing.join(', ')}. Copy .env.example to .env.`
    )
  }

  cached = {
    databaseUrl: parseUrl('DATABASE_URL', process.env.DATABASE_URL!, ['postgres:', 'postgresql:']),
    schedraUrl: parseUrl('SCHEDRA_URL', process.env.SCHEDRA_URL!, ['http:', 'https:'])
  }

  return cached
}

export function resetEnv() {
  cached = null
}
