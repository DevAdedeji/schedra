import { defineConfig } from 'vitest/config'
import { existsSync } from 'node:fs'

if (existsSync('.env')) {
  process.loadEnvFile()
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts'],

    fileParallelism: false,

    coverage: {
      provider: 'v8',
      include: ['server/domain/**/*.ts'],
      exclude: ['server/domain/types.ts']
    }
  }
})
