<script setup lang="ts">
definePageMeta({ layout: 'app', middleware: ['auth', 'platform-admin'] })
useSeoMeta({ title: 'Control', robots: 'noindex, nofollow' })
await navigateTo('/control/operations', { redirectCode: 301 })
</script>

<template>
  <div />
</template>
