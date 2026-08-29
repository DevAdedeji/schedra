<script setup lang="ts">
import { analyticsAllowedForRoute } from '#shared/analytics'

const route = useRoute()
// SCHEDRA_URL is the authoritative public origin — the same value better-auth
// builds callbacks from. The request host cannot be trusted behind a proxy and
// is absent entirely during prerender.
const { url: siteUrl, indexable } = useSiteUrl()
const origin = siteUrl.value

const title = 'Schedra — share a link, get booked'
const description = 'Share one link and let people pick a time that suits you both. Meetings land in your calendar with reminders sent and timezones handled.'
const ogImage = `${origin}/og.png`
const analyticsAllowed = computed(() => !import.meta.dev && analyticsAllowedForRoute(route.name))

const clarityScript = `(function(c,l,a,r,i,t,y){
  c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
  var v=null;try{v=c.localStorage.getItem("schedra:analytics-consent:v1")}catch(e){}
  c[a]("consentv2",{ad_Storage:"denied",analytics_Storage:v==="granted"?"granted":"denied"});
  t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
  y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window,document,"clarity","script","y9n1tiv1yp");`

const canonical = computed(() => `${origin}${route.path === '/' ? '' : route.path}`)

useHead(() => ({
  htmlAttrs: { lang: 'en' },
  titleTemplate: chunk => (chunk && chunk !== title ? `${chunk} — Schedra` : title),
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    { name: 'theme-color', content: '#FF3D00' }
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
    { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    { key: 'canonical', rel: 'canonical', href: canonical }
  ],
  // Staging and production are built with NODE_ENV=production. Keeping the
  // tracker out of dev prevents local navigation from polluting Clarity.
  script: analyticsAllowed.value
    ? [{ key: 'microsoft-clarity', type: 'text/javascript', innerHTML: clarityScript }]
    : []
}))

useSeoMeta({
  // Staging serves the same pages as production; letting search engines index
  // both splits rankings between them.
  robots: indexable.value ? 'index, follow' : 'noindex, nofollow',
  title,
  description,
  ogType: 'website',
  ogSiteName: 'Schedra',
  ogLocale: 'en',
  ogTitle: title,
  ogDescription: description,
  ogUrl: canonical,
  ogImage,
  ogImageWidth: 1200,
  ogImageHeight: 630,
  ogImageAlt: 'Schedra — share a link, get booked',
  twitterCard: 'summary_large_image',
  twitterTitle: title,
  twitterDescription: description,
  twitterImage: ogImage
})
</script>

<template>
  <UApp>
    <NuxtLoadingIndicator
      color="#FF3D00"
      :height="2"
    />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <AnalyticsConsentBanner />
  </UApp>
</template>
