export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  routeRules: {
    '/': { prerender: true },
    '/signup': { prerender: false },
    '/login': { prerender: false },
    '/forgot-password': { prerender: false },
    '/reset-password': { prerender: false },
    '/verify-email': { prerender: false },
    '/dashboard': { prerender: false }
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
      { name: 'Instrument Serif', provider: 'google' }
    ]
  }
})
