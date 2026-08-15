<script setup lang="ts">
const title = 'Schedra — open-source scheduling you run yourself'
const description = 'An open-source, self-hostable scheduling platform. One container, one Postgres, ten environment variables. Your calendar data never leaves your infrastructure.'

useHead({
  htmlAttrs: { lang: 'en' },
  meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
  link: [
    { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
    { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }
  ]
})

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  twitterCard: 'summary_large_image'
})
</script>

<template>
  <UApp>
    <SiteHeader />

    <main>
      <NuxtPage />
    </main>

    <SiteFooter />
  </UApp>
</template>
