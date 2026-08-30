import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

if (!process.env.SCHEDRA_URL && existsSync('.env')) {
  process.loadEnvFile('.env')
}

const rawSiteUrl = process.env.SCHEDRA_URL?.trim()
if (!rawSiteUrl) {
  throw new Error('SCHEDRA_URL is required to verify prerendered SEO metadata.')
}

const parsedSiteUrl = new URL(rawSiteUrl)
if (!['http:', 'https:'].includes(parsedSiteUrl.protocol)) {
  throw new Error('SCHEDRA_URL must use http or https.')
}
if (parsedSiteUrl.pathname !== '/' || parsedSiteUrl.search || parsedSiteUrl.hash) {
  throw new Error('SCHEDRA_URL must be an origin without a path, query, or fragment.')
}

const siteUrl = parsedSiteUrl.origin
const indexable = parsedSiteUrl.hostname === 'schedra.xyz'
const publicDirectory = resolve('.output/public')
const routes = [
  '/',
  '/features',
  '/pricing',
  '/privacy',
  '/terms',
  '/support',
  '/docs/integrations/zoom'
]

function generatedFile(route) {
  return route === '/'
    ? resolve(publicDirectory, 'index.html')
    : resolve(publicDirectory, route.slice(1), 'index.html')
}

function expectedCanonical(route) {
  return `${siteUrl}${route === '/' ? '' : route}`
}

function attributeValues(html, tagPattern, attribute) {
  return [...html.matchAll(tagPattern)]
    .map(match => match[0].match(new RegExp(`\\b${attribute}="([^"]+)"`, 'i'))?.[1])
    .filter(Boolean)
}

for (const route of routes) {
  const file = generatedFile(route)
  if (!existsSync(file)) {
    throw new Error(`Missing prerendered SEO output for ${route}: ${file}`)
  }

  const html = readFileSync(file, 'utf8')
  const canonical = expectedCanonical(route)
  const robots = indexable ? 'index, follow' : 'noindex, nofollow'
  const canonicalUrls = attributeValues(html, /<link\b(?=[^>]*\brel="canonical")[^>]*>/gi, 'href')
  const openGraphUrls = attributeValues(html, /<meta\b(?=[^>]*\bproperty="og:url")[^>]*>/gi, 'content')
  const robotsDirectives = attributeValues(html, /<meta\b(?=[^>]*\bname="robots")[^>]*>/gi, 'content')

  if (!canonicalUrls.length || canonicalUrls.some(url => url !== canonical)) {
    throw new Error(`${route} does not contain the expected canonical URL ${canonical}.`)
  }
  if (!openGraphUrls.length || openGraphUrls.some(url => url !== canonical)) {
    throw new Error(`${route} does not contain the expected Open Graph URL ${canonical}.`)
  }
  if (!robotsDirectives.length || robotsDirectives.some(directive => directive !== robots)) {
    throw new Error(`${route} does not contain the expected robots directive ${robots}.`)
  }
  if (indexable && /https?:\/\/localhost(?=[/:"'])/i.test(html)) {
    throw new Error(`${route} contains a localhost URL in a production prerender.`)
  }
}

console.log(`Verified prerendered SEO metadata for ${routes.length} routes (${siteUrl}).`)
