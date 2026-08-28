<script setup lang="ts">
definePageMeta({ layout: 'app', middleware: 'auth' })
useSeoMeta({ title: 'Booking analytics', robots: 'noindex, nofollow' })
</script>

<template>
  <AnalyticsDashboard />
</template>
