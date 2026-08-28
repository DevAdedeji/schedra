import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { TEAM_PLAN } from '#shared/billing'
import {
  eventTypes,
  organizations,
  organizationSubscriptions,
  users
} from '../database/schema'
import { useDatabase } from '../database/index'
import { useEnv } from '../config/env'

interface SitemapPage {
  path: string
  priority: string
  changefreq: 'daily' | 'weekly'
  lastmod?: Date
}

function xml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll(/\u0027/g, '&apos;')
}

export default defineEventHandler(async (event) => {
  const { schedraUrl } = useEnv()
  const db = useDatabase()
  const [publicEventTypes, publicTeamEventTypes] = await Promise.all([
    db.select({
      username: users.username,
      slug: eventTypes.slug,
      eventUpdatedAt: eventTypes.updatedAt
    })
      .from(eventTypes)
      .innerJoin(users, eq(users.id, eventTypes.userId))
      .where(and(eq(users.emailVerified, true), eq(eventTypes.hidden, false)))
      .orderBy(asc(users.username), asc(eventTypes.slug))
      .limit(24_998),
    db.select({
      teamSlug: organizations.slug,
      eventSlug: eventTypes.slug,
      eventUpdatedAt: eventTypes.updatedAt
    })
      .from(eventTypes)
      .innerJoin(organizations, eq(organizations.id, eventTypes.organizationId))
      .innerJoin(
        organizationSubscriptions,
        eq(organizationSubscriptions.organizationId, organizations.id)
      )
      .where(and(
        eq(eventTypes.hidden, false),
        isNull(organizations.archivedAt),
        // Mirror the entitlement grace rules closely enough that crawlers do
        // not receive links to teams whose public booking page is read-only.
        sql`case
          when ${organizationSubscriptions.collectionMethod} = 'charge_automatically'
            then ${organizationSubscriptions.status} in ('trialing', 'active', 'past_due')
          when ${organizationSubscriptions.status} = 'trialing'
            then ${organizationSubscriptions.trialEndsAt} is null
              or ${organizationSubscriptions.trialEndsAt} + (${TEAM_PLAN.graceDays} * interval '1 day') >= now()
          when ${organizationSubscriptions.status} = 'active'
            then ${organizationSubscriptions.currentPeriodEnd} is null
              or ${organizationSubscriptions.currentPeriodEnd} + (${TEAM_PLAN.graceDays} * interval '1 day') >= now()
          when ${organizationSubscriptions.status} = 'past_due'
            then coalesce(
              ${organizationSubscriptions.graceEndsAt},
              ${organizationSubscriptions.updatedAt} + (${TEAM_PLAN.graceDays} * interval '1 day')
            ) >= now()
          else false
        end`
      ))
      .orderBy(asc(organizations.slug), asc(eventTypes.slug))
      .limit(24_998)
  ])

  const pages: SitemapPage[] = [
    { path: '/', priority: '1.0', changefreq: 'weekly' },
    { path: '/features', priority: '0.9', changefreq: 'weekly' },
    { path: '/pricing', priority: '0.9', changefreq: 'weekly' },
    { path: '/support', priority: '0.5', changefreq: 'weekly' },
    { path: '/docs/integrations/zoom', priority: '0.5', changefreq: 'weekly' },
    { path: '/privacy', priority: '0.3', changefreq: 'weekly' },
    { path: '/terms', priority: '0.3', changefreq: 'weekly' }
  ]
  const profiles = new Map<string, Date>()
  const bookingPages: SitemapPage[] = []

  for (const item of publicEventTypes) {
    const profileUpdatedAt = profiles.get(item.username)
    profiles.set(item.username, !profileUpdatedAt || item.eventUpdatedAt > profileUpdatedAt
      ? item.eventUpdatedAt
      : profileUpdatedAt)
    bookingPages.push({
      path: `/${encodeURIComponent(item.username)}/${encodeURIComponent(item.slug)}`,
      priority: '0.7',
      changefreq: 'daily',
      lastmod: item.eventUpdatedAt
    })
  }

  for (const [username, lastmod] of profiles) {
    pages.push({
      path: `/${encodeURIComponent(username)}`,
      priority: '0.8',
      changefreq: 'daily',
      lastmod
    })
  }
  pages.push(...bookingPages)

  const teams = new Map<string, Date>()
  for (const item of publicTeamEventTypes) {
    const teamUpdatedAt = teams.get(item.teamSlug)
    teams.set(item.teamSlug, !teamUpdatedAt || item.eventUpdatedAt > teamUpdatedAt
      ? item.eventUpdatedAt
      : teamUpdatedAt)
    pages.push({
      path: `/team/${encodeURIComponent(item.teamSlug)}/${encodeURIComponent(item.eventSlug)}`,
      priority: '0.7',
      changefreq: 'daily',
      lastmod: item.eventUpdatedAt
    })
  }
  for (const [teamSlug, lastmod] of teams) {
    pages.push({
      path: `/team/${encodeURIComponent(teamSlug)}`,
      priority: '0.8',
      changefreq: 'daily',
      lastmod
    })
  }

  setResponseHeader(event, 'content-type', 'application/xml; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400')

  const urls = pages.slice(0, 49_999).map(page => `  <url>
    <loc>${xml(`${schedraUrl}${page.path}`)}</loc>
${page.lastmod ? `    <lastmod>${page.lastmod.toISOString()}</lastmod>\n` : ''}    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
})
