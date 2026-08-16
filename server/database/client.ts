import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export type Database = ReturnType<typeof createDatabase>['db']

/**
 * PgBouncer in transaction mode — what Neon's `-pooler` host and Supabase's
 * 6543 port both use — cannot keep prepared statements alive between queries,
 * and postgres.js prepares by default. Without this the app works until two
 * requests overlap, then throws "prepared statement already exists".
 */
export function isPooledUrl(url: string) {
  return /-pooler\./i.test(url) || /pgbouncer=true/i.test(url)
}

export function createDatabase(url: string, options: postgres.Options<Record<string, never>> = {}) {
  const client = postgres(url, {
    prepare: isPooledUrl(url) ? false : undefined,
    ...options
  })

  return { db: drizzle(client, { schema, casing: 'snake_case' }), client }
}
