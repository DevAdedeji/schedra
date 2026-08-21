<script setup lang="ts">
const origin = useRuntimeConfig().public.siteUrl || useRequestURL().origin

useHead({
  script: [{
    type: 'application/ld+json',
    innerHTML: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      'name': 'Schedra',
      'url': origin,
      'applicationCategory': 'BusinessApplication',
      'operatingSystem': 'Web',
      'description': 'Share one link and let people pick a time that suits you both. Meetings land in your calendar with reminders sent, timezones handled.',
      'offers': {
        '@type': 'Offer',
        'price': '0',
        'priceCurrency': 'USD'
      },
      'featureList': [
        'Booking pages',
        'Calendar sync',
        'Timezone-correct scheduling',
        'Automatic reminders',
        'Team scheduling'
      ]
    })
  }]
})
</script>

<template>
  <div>
    <LandingHero />
    <LandingHowItWorks />
    <LandingFeatures />
    <LandingTimezones />
    <LandingDevelopers />
    <LandingCta />
  </div>
</template>
