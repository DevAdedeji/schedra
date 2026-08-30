<script setup lang="ts">
definePageMeta({ layout: 'app', middleware: 'auth' })
useSeoMeta({ title: 'Booking analytics', robots: 'noindex, nofollow' })
const { data } = await useCurrentUser()
const isPro = computed(() => Boolean(data.value?.personalPlan?.isPro))
</script>

<template>
  <AnalyticsDashboard :personal-pro="isPro" />
</template>
