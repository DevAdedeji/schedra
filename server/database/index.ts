import { createDatabase, type Database } from './client'
import { useEnv } from '../config/env'

let cached: Database | null = null

export function useDatabase(): Database {
  if (!cached) {
    cached = createDatabase(useEnv().databaseUrl).db
  }

  return cached
}
