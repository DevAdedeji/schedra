import { sql } from 'drizzle-orm'
import { useDatabase } from '../database/index'
import { logEvent } from '../observability/logger'

export default defineEventHandler(async (event) => {
  try {
    const [readiness] = await useDatabase().execute<{
      database: boolean
      overlap_constraint: boolean
      api_rate_limits: boolean
      email_outbox: boolean
      auth_rate_limits: boolean
      calendar_sync_jobs: boolean
      webhook_deliveries: boolean
      operations_alerts: boolean
    }>(sql`select
      true as database,
      exists(select 1 from pg_constraint where conname = 'bookings_no_overlap_per_host') as overlap_constraint,
      to_regclass('public.api_rate_limits') is not null as api_rate_limits,
      to_regclass('public.email_outbox') is not null as email_outbox,
      to_regclass('public.rate_limits') is not null as auth_rate_limits,
      to_regclass('public.calendar_sync_jobs') is not null as calendar_sync_jobs,
      to_regclass('public.webhook_deliveries') is not null as webhook_deliveries,
      to_regclass('public.operations_alerts') is not null as operations_alerts`)

    if (!readiness || !Object.values(readiness).every(Boolean)) {
      setResponseStatus(event, 503)
      logEvent('error', 'readiness_check_failed', { checks: readiness ?? {} }, event)
      return { ok: false }
    }
    return { ok: true }
  } catch (error) {
    setResponseStatus(event, 503)
    logEvent('error', 'readiness_check_failed', { error }, event)
    return { ok: false }
  }
})
