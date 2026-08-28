<script setup lang="ts">
definePageMeta({ layout: 'bare' })
const route = useRoute()
</script>

<template>
  <RoutingFormFlow
    mode="team"
    :owner="String(route.params.slug)"
    :slug="String(route.params.form)"
  />
</template>
