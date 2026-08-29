import { createDatabase, type Database } from './client'
import { useEnv } from '../config/env'

let cached: Database | null = null

export function useDatabase(): Database {
  if (!cached) {
    const env = useEnv()
    cached = createDatabase(env.databaseUrl, {
      max: env.databasePoolMax,
      connect_timeout: env.databaseConnectTimeoutSeconds,
      idle_timeout: env.databaseIdleTimeoutSeconds,
      connection: {
        application_name: `schedra-${env.environment}-${env.processRole}`,
        statement_timeout: env.databaseStatementTimeoutMs,
        lock_timeout: env.databaseLockTimeoutMs,
        idle_in_transaction_session_timeout: env.databaseIdleTransactionTimeoutMs
      }
    }).db
  }

  return cached
}
