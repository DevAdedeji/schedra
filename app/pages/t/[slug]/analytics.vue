<script setup lang="ts">
definePageMeta({ layout: 'app', middleware: 'auth' })
const route = useRoute()
const slug = computed(() => String(route.params.slug ?? ''))
useSeoMeta({ title: 'Team booking analytics', robots: 'noindex, nofollow' })
</script>

<template>
  <AnalyticsDashboard :team-slug="slug" />
</template>
