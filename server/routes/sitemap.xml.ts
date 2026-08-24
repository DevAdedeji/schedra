import { and, asc, eq } from 'drizzle-orm'
import { eventTypes, users } from '../database/schema'
import { useDatabase } from '../utils/database'
import { useEnv } from '../utils/env'

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
  const publicEventTypes = await useDatabase()
    .select({
      username: users.username,
      slug: eventTypes.slug,
      eventUpdatedAt: eventTypes.updatedAt
    })
    .from(eventTypes)
    .innerJoin(users, eq(users.id, eventTypes.userId))
    .where(and(eq(users.emailVerified, true), eq(eventTypes.hidden, false)))
    .orderBy(asc(users.username), asc(eventTypes.slug))
    .limit(49_998)

  const pages: SitemapPage[] = [{ path: '/', priority: '1.0', changefreq: 'weekly' }]
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
