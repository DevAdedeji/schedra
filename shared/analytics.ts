import { z } from 'zod'

export const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)])).default(30),
  eventTypeId: z.uuid().optional()
})

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>

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
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(from)
    date.setUTCDate(date.getUTCDate() + index)
    const key = date.toISOString().slice(0, 10)
    return { date: key, value: values.get(key) ?? 0 }
  })
}
