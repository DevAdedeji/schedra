<script setup lang="ts">
import { seoLandingPages } from '~/data/seo-landing-pages'

definePageMeta({ layout: 'default' })
const page = seoLandingPages['/solutions/consultants']!
</script>

<template>
  <SeoLandingPage :page="page" />
</template>
