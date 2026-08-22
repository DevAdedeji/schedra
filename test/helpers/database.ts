export function getTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL?.trim()
  if (!value) return undefined

  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('TEST_DATABASE_URL must be a Postgres connection string')
  }

  const database = decodeURIComponent(url.pathname.slice(1))
  if (!/(^|[-_])test($|[-_])/i.test(database)) {
    throw new Error(
      `Refusing destructive database tests against "${database}". `
      + 'TEST_DATABASE_URL must name an isolated test database.'
    )
  }

  return value
}

export function configureAppTestEnvironment(databaseUrl: string) {
  process.env.DATABASE_URL = databaseUrl
  process.env.SCHEDRA_URL ||= 'http://localhost:3002'
  process.env.AUTH_SECRET ||= 'x'.repeat(32)
}
