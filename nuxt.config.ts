export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui'
  ],

  devtools: {
    enabled: process.env.NODE_ENV !== 'production' && process.env.NUXT_DISABLE_DEVTOOLS !== '1'
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    public: {
      siteUrl: ''
    }
  },

  routeRules: {
    '/': { prerender: true },
    '/pricing': { prerender: true },
    '/embed.js': {
      headers: {
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=300, stale-while-revalidate=86400',
        'cross-origin-resource-policy': 'cross-origin',
        'x-content-type-options': 'nosniff'
      }
    },
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
