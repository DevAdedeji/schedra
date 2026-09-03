<script setup lang="ts">
import { seoLandingPages } from '~/data/seo-landing-pages'

definePageMeta({ layout: 'default' })
const page = seoLandingPages['/features/booking-widget']!
</script>

<template>
  <SeoLandingPage :page="page" />
</template>
