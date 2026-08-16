import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export type Database = ReturnType<typeof createDatabase>['db']

export function createDatabase(url: string, options?: postgres.Options<Record<string, never>>) {
  const client = postgres(url, options)
  return { db: drizzle(client, { schema, casing: 'snake_case' }), client }
}
