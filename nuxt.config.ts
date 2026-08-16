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
    '/': { prerender: true }
  },

  compatibilityDate: '2026-06-30',

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
