import { defineConfig } from 'drizzle-kit'

// DDL through a connection pooler is unreliable, so migrations prefer the
// direct endpoint when the app itself is pointed at a pooled one.
const url = process.env.DIRECT_URL || process.env.DATABASE_URL

if (!url) {
  throw new Error('DATABASE_URL is not set — copy .env.example to .env')
}

export default defineConfig({
  schema: './server/database/schema.ts',
  out: './server/database/migrations',
  dialect: 'postgresql',
  casing: 'snake_case',
  dbCredentials: { url }
})
