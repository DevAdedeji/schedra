import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { existsSync } from 'node:fs'

if (existsSync('.env')) {
  process.loadEnvFile()
}

const testMode = process.argv.includes('--test')
if (testMode && existsSync('.env.test')) {
  process.loadEnvFile('.env.test')
}
// DDL through a connection pooler is unreliable, so prefer the direct endpoint.
const url = testMode
  ? process.env.TEST_DATABASE_URL
  : process.env.DIRECT_URL || process.env.DATABASE_URL

if (!url) {
  console.error(`${testMode ? 'TEST_DATABASE_URL' : 'DATABASE_URL'} is not set`)
  process.exit(1)
}

if (testMode) {
  const database = decodeURIComponent(new URL(url).pathname.slice(1))
  if (!/(^|[-_])test($|[-_])/i.test(database)) {
    console.error(`Refusing to migrate non-test database "${database}" in test mode`)
    process.exit(1)
  }
}

const client = postgres(url, { max: 1, onnotice: () => {} })

try {
  await migrate(drizzle(client), { migrationsFolder: 'server/database/migrations' })
  console.log('migrations applied')
} catch (error) {
  console.error('migration failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await client.end()
}
