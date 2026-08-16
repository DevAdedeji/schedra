/**
 * Applies pending migrations. Uses drizzle-orm's migrator rather than
 * drizzle-kit so it runs in a production image, where devDependencies are
 * pruned away.
 */
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

try {
  process.loadEnvFile()
} catch {
  // No .env — the platform supplies real environment variables.
}

// DDL through a connection pooler is unreliable, so prefer the direct endpoint.
const url = process.env.DIRECT_URL || process.env.DATABASE_URL

if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
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
