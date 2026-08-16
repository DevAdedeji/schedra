import { sql } from 'drizzle-orm'
import { useDatabase } from '../utils/database'

/**
 * Railway's healthcheck target. Checks the constraint rather than just the
 * connection: without `bookings_no_overlap_per_host` the app still serves
 * traffic perfectly while quietly accepting double bookings, which is worse
 * than being down.
 */
export default defineEventHandler(async (event) => {
  const rows = await useDatabase().execute<{ conname: string }>(
    sql`select conname from pg_constraint where conname = 'bookings_no_overlap_per_host'`
  )

  if (rows.length === 0) {
    setResponseStatus(event, 503)
    return {
      ok: false,
      error: 'bookings_no_overlap_per_host is missing — migrations have not run'
    }
  }

  return { ok: true }
})
