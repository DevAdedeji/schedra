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
      'description': 'Share one link and let people pick a time that suits you both. Timezones, confirmations, cancellations and rescheduling stay clear.',
      'offers': {
        '@type': 'Offer',
        'price': '0',
        'priceCurrency': 'USD'
      },
      'featureList': [
        'Booking pages',
        'Timezone-correct scheduling',
        'Reusable availability schedules',
        'Routing forms',
        'Workflow automation',
        'Booking analytics',
        'Paid bookings',
        'Group events',
        'Round-robin and collective team scheduling',
        'Embeddable booking overlays',
        'Google Calendar, Microsoft Calendar and Zoom integrations',
        'Cancellation and rescheduling'
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
    <LandingEmbedShowcase />
    <LandingTimezones />
    <LandingCta />
  </div>
</template>
