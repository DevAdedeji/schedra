<script setup lang="ts">
import { seoLandingPages } from '~/data/seo-landing-pages'

definePageMeta({ layout: 'default' })
const page = seoLandingPages['/solutions/paid-appointments']!
</script>

<template>
  <SeoLandingPage :page="page" />
</template>
