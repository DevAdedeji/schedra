// https://nuxt.com/docs/api/configuration/nuxt-config
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
    // Authenticated routes read a session, so they must render per request.
    '/signup': { prerender: false },
    '/login': { prerender: false },
    '/forgot-password': { prerender: false },
    '/reset-password': { prerender: false },
    '/verify-email': { prerender: false },
    '/dashboard': { prerender: false }
  },

  compatibilityDate: '2026-06-30',

  // Only the marketing page is static; crawling would drag the auth pages in
  // and they have no database at build time.
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

  // Declared explicitly: nuxt-fonts resolves families from `font-family`
  // declarations, and does not pick this one up from the Tailwind theme token.
  fonts: {
    families: [
      { name: 'Instrument Serif', provider: 'google' }
    ]
  }
})
