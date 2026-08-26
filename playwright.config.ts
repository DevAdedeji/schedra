import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

if (existsSync('.env.test')) process.loadEnvFile('.env.test')

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for Playwright tests.')

const baseURL = 'http://127.0.0.1:3102'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome']
  },
  webServer: {
    command: './node_modules/.bin/nuxt dev --host 127.0.0.1 --port 3102',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: databaseUrl,
      DIRECT_URL: databaseUrl,
      TEST_DATABASE_URL: databaseUrl,
      SCHEDRA_URL: baseURL,
      AUTH_SECRET: 'playwright-only-secret-with-at-least-thirty-two-characters',
      // Playwright uses an isolated port and test database, so it is safe to
      // run alongside the developer's normal Nuxt process for this workspace.
      NUXT_IGNORE_LOCK: '1'
    }
  }
})
