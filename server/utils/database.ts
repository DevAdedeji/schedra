import { createDatabase, type Database } from '../database/client'
import { useEnv } from './env'

let cached: Database | null = null

export function useDatabase(): Database {
  if (!cached) {
    cached = createDatabase(useEnv().databaseUrl).db
  }

  return cached
}
