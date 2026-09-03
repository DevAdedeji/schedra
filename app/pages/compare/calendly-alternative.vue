<script setup lang="ts">
import { seoLandingPages } from '~/data/seo-landing-pages'

definePageMeta({ layout: 'default' })
const page = seoLandingPages['/compare/calendly-alternative']!
</script>

<template>
  <SeoLandingPage :page="page" />
</template>
