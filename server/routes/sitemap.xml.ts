import { useEnv } from '../utils/env'

const pages = [{ path: '/', priority: '1.0', changefreq: 'weekly' }]

export default defineEventHandler((event) => {
  const { schedraUrl } = useEnv()

  setResponseHeader(event, 'content-type', 'application/xml; charset=utf-8')

  const urls = pages.map(page => `  <url>
    <loc>${schedraUrl}${page.path === '/' ? '/' : page.path}</loc>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
})
