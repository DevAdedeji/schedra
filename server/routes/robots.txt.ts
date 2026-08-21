import { useEnv } from '../utils/env'

const disallowed = ['/dashboard', '/signup', '/login', '/forgot-password', '/reset-password', '/verify-email', '/api/']

const PRODUCTION_HOST = 'schedra.xyz'

export default defineEventHandler((event) => {
  const { schedraUrl } = useEnv()

  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')

  if (new URL(schedraUrl).host !== PRODUCTION_HOST) {
    return 'User-agent: *\nDisallow: /\n'
  }

  return [
    'User-agent: *',
    ...disallowed.map(path => `Disallow: ${path}`),
    '',
    `Sitemap: ${schedraUrl}/sitemap.xml`,
    ''
  ].join('\n')
})
