import { sql } from 'drizzle-orm'
import { useDatabase } from '../utils/database'

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
