const buildSiteUrl = process.env.SCHEDRA_URL?.trim().replace(/\/+$/, '') ?? ''
const publicPage = () => ({
  prerender: true,
  headers: { 'cache-control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400' }
})

// Railway may set NODE_ENV=production while dependencies are installing, and
// Nuxt loads this config from its postinstall `prepare` hook. Require the URL
// only for the actual project build, where prerendered metadata is generated.
if (process.env.npm_lifecycle_event === 'build' && !buildSiteUrl) {
  throw new Error('SCHEDRA_URL is required while building so prerendered pages use the public origin.')
}

export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui'
  ],
  components: [
    { path: '~/components', pathPrefix: false }
  ],
  devtools: {
    enabled: process.env.NODE_ENV !== 'production' && process.env.NUXT_DISABLE_DEVTOOLS !== '1'
  },
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    public: {
      // Nitro supplies this per request at runtime. Prerendering has no request,
      // so it also needs the public origin while Nuxt is building the HTML.
      siteUrl: buildSiteUrl
    }
  },
  routeRules: {
    '/': publicPage(),
    '/features': publicPage(),
    '/features/booking-widget': publicPage(),
    '/pricing': publicPage(),
    '/solutions/consultants': publicPage(),
    '/solutions/small-business': publicPage(),
    '/solutions/paid-appointments': publicPage(),
    '/solutions/team-scheduling': publicPage(),
    '/compare/calendly-alternative': publicPage(),
    '/privacy': publicPage(),
    '/terms': publicPage(),
    '/support': publicPage(),
    '/docs/integrations/zoom': publicPage(),
    '/embed.js': {
      headers: {
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=300, stale-while-revalidate=86400',
        'cross-origin-resource-policy': 'cross-origin',
        'x-content-type-options': 'nosniff'
      }
    },
    '/embed/**': { prerender: false, headers: { 'cache-control': 'private, no-store' } },
    '/api/**': { headers: { 'cache-control': 'no-store' } },
    '/signup': { prerender: false, headers: { 'cache-control': 'private, no-store' } },
    '/login': { prerender: false, headers: { 'cache-control': 'private, no-store' } },
    '/forgot-password': { prerender: false, headers: { 'cache-control': 'private, no-store' } },
    '/reset-password': { prerender: false, headers: { 'cache-control': 'private, no-store' } },
    '/verify-email': { prerender: false, headers: { 'cache-control': 'private, no-store' } },
    '/dashboard': { prerender: false, headers: { 'cache-control': 'private, no-store' } },
    '/event-types': { prerender: false, headers: { 'cache-control': 'private, no-store' } },
    '/bookings': { prerender: false, headers: { 'cache-control': 'private, no-store' } },
    '/availability': { prerender: false, headers: { 'cache-control': 'private, no-store' } },
    '/integrations': { prerender: false, headers: { 'cache-control': 'private, no-store' } },
    '/operations': { prerender: false, headers: { 'cache-control': 'private, no-store' } },
    '/control/**': { prerender: false, headers: { 'cache-control': 'private, no-store' } },
    '/settings': { prerender: false, headers: { 'cache-control': 'private, no-store' } },
    '/booking/**': { prerender: false, headers: { 'cache-control': 'private, no-store' } },
    '/t/**': { prerender: false, headers: { 'cache-control': 'private, no-store' } },
    '/invite/**': { prerender: false, headers: { 'cache-control': 'private, no-store' } }
  },
  compatibilityDate: '2026-06-30',
  nitro: {
    prerender: {
      crawlLinks: false
    }
  },
  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },
  fonts: {
    families: [
      { name: 'Instrument Serif', provider: 'google' },
      { name: 'Figtree', provider: 'google' }
    ]
  }
})
