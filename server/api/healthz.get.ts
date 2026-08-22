import { sql } from 'drizzle-orm'
import { useDatabase } from '../utils/database'

export default defineEventHandler(async (event) => {
  const [readiness] = await useDatabase().execute<{
    overlap_constraint: boolean
    api_rate_limits: boolean
    email_outbox: boolean
    auth_rate_limits: boolean
  }>(
    sql`select
      exists(select 1 from pg_constraint where conname = 'bookings_no_overlap_per_host') as overlap_constraint,
      to_regclass('public.api_rate_limits') is not null as api_rate_limits,
      to_regclass('public.email_outbox') is not null as email_outbox,
      to_regclass('public.rate_limits') is not null as auth_rate_limits`
  )

  if (!readiness || !Object.values(readiness).every(Boolean)) {
    setResponseStatus(event, 503)
    return {
      ok: false,
      error: 'database migrations are incomplete'
    }
  }

  return { ok: true }
})
