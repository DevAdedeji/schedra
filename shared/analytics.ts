import { z } from 'zod'
import { Temporal } from '@js-temporal/polyfill'

export const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)])).default(30),
  eventTypeId: z.uuid().optional()
})

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>

const ANALYTICS_ROUTE_PAGES: Record<string, { path: string, title: string }> = {
  'index': { path: '/', title: 'Home' },
  'features': { path: '/features', title: 'Features' },
  'pricing': { path: '/pricing', title: 'Pricing' },
  'privacy': { path: '/privacy', title: 'Privacy' },
  'support': { path: '/support', title: 'Support' },
  'terms': { path: '/terms', title: 'Terms' },
  'docs-integrations-zoom': { path: '/docs/integrations/zoom', title: 'Zoom integration documentation' },
  'username': { path: '/public-profile', title: 'Public profile' },
  'username-slug': { path: '/booking/personal', title: 'Personal booking page' },
  'team-slug': { path: '/booking/team-profile', title: 'Team profile' },
  'team-slug-event': { path: '/booking/team', title: 'Team booking page' },
  'route-owner-slug': { path: '/routing/personal', title: 'Personal routing form' },
  'team-slug-route-form': { path: '/routing/team', title: 'Team routing form' },
  'meeting-token': { path: '/booking/private-link', title: 'Private booking page' },
  'booking-uid': { path: '/booking/details', title: 'Booking details' },
  'invite-id': { path: '/team/invitation', title: 'Team invitation' },
  'embed-personal-username-slug': { path: '/embed/personal', title: 'Embedded personal booking page' },
  'embed-team-slug-event': { path: '/embed/team', title: 'Embedded team booking page' }
}

/**
 * Umami receives route categories, never the concrete URL. Dynamic usernames,
 * team slugs, booking IDs, invitation IDs, private tokens, query strings and
 * hashes therefore remain inside Schedra.
 */
export function analyticsPageForRoute(routeName: unknown) {
  const name = String(routeName ?? '').trim()
  const known = ANALYTICS_ROUTE_PAGES[name]
  if (known) return known

  const safeName = name.toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return {
    path: safeName ? `/page/${safeName}` : '/page/unknown',
    title: safeName
      ? safeName.split('-').map(word => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(' ')
      : 'Unknown page'
  }
}

export function analyticsReferrerOrigin(value: unknown) {
  if (typeof value !== 'string' || !value) return ''
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
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
