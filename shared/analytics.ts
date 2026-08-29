import { z } from 'zod'
import { Temporal } from '@js-temporal/polyfill'

export const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)])).default(30),
  eventTypeId: z.uuid().optional()
})

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>

/**
 * Clarity is deliberately limited to informational marketing pages. Public
 * booking pages, authenticated screens and capability-link routes can contain
 * attendee, authentication or financial context and must never load a session
 * recorder, even when storage consent is denied.
 */
const ANALYTICS_ROUTE_NAMES = new Set([
  'index',
  'features',
  'pricing',
  'privacy',
  'support',
  'terms',
  'docs-integrations-zoom'
])

export function analyticsAllowedForRoute(routeName: unknown) {
  return ANALYTICS_ROUTE_NAMES.has(String(routeName ?? ''))
}

export function percentage(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0
}

export function percentageChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null
  return Math.round(((current - previous) / previous) * 1000) / 10
}

export function fillDailySeries(
  from: Date,
  days: number,
  rows: Array<{ date: string, value: number }>
) {
  const values = new Map(rows.map(row => [row.date, Number(row.value)]))
  const first = Temporal.Instant.from(from.toISOString()).toZonedDateTimeISO('UTC').toPlainDate()
  return Array.from({ length: days }, (_, index) => {
    const key = first.add({ days: index }).toString()
    return { date: key, value: values.get(key) ?? 0 }
  })
}
