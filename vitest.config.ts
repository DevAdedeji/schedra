import { defineConfig } from 'vitest/config'
import { existsSync } from 'node:fs'

if (existsSync('.env.test')) {
  process.loadEnvFile('.env.test')
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts'],

    fileParallelism: false,

    coverage: {
      provider: 'v8',
      include: ['server/domain/**/*.ts'],
      exclude: ['server/domain/types.ts'],
      thresholds: {
        branches: 95,
        functions: 95,
        lines: 95,
        statements: 95
      }
    }
  }
})
