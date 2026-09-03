<script setup lang="ts">
const origin = useRuntimeConfig().public.siteUrl || useRequestURL().origin

useHead({
  script: [{
    key: 'schedra-home-structured-data',
    type: 'application/ld+json',
    innerHTML: JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': `${origin}/#organization`,
          'name': 'Schedra',
          'url': origin,
          'logo': `${origin}/favicon.svg`,
          'email': 'support@schedra.xyz'
        },
        {
          '@type': 'WebSite',
          '@id': `${origin}/#website`,
          'name': 'Schedra',
          'url': origin,
          'publisher': { '@id': `${origin}/#organization` }
        },
        {
          '@type': 'SoftwareApplication',
          '@id': `${origin}/#software`,
          'name': 'Schedra',
          'url': origin,
          'applicationCategory': 'BusinessApplication',
          'operatingSystem': 'Web',
          'description': 'Online scheduling software for booking pages, automated reminders, paid appointments and team scheduling.',
          'offers': {
            '@type': 'Offer',
            'price': '0',
            'priceCurrency': 'USD'
          },
          'featureList': [
            'Booking pages',
            'Single-use links and one-off meeting invitations',
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
          ],
          'publisher': { '@id': `${origin}/#organization` }
        }
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
    <LandingUseCases />
    <LandingEmbedShowcase />
    <LandingTimezones />
    <LandingCta />
  </div>
</template>
