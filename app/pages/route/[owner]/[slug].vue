<script setup lang="ts">
definePageMeta({ layout: 'bare' })
const route = useRoute()
</script>

<template>
  <RoutingFormFlow
    mode="personal"
    :owner="String(route.params.owner)"
    :slug="String(route.params.slug)"
  />
</template>
