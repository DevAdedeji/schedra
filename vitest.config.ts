import { defineConfig } from 'vitest/config'

try {
  process.loadEnvFile()
} catch {
  // No .env — the pure domain tests still run.
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts'],

    // Database tests share one Postgres and truncate between cases, so running
    // files in parallel lets one wipe another's fixtures mid-test.
    fileParallelism: false,

    coverage: {
      provider: 'v8',
      include: ['server/domain/**/*.ts'],
      exclude: ['server/domain/types.ts']
    }
  }
})
