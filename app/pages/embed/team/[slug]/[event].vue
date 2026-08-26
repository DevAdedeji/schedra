<script setup lang="ts">
definePageMeta({ layout: 'bare' })

const route = useRoute()
const team = String(route.params.slug ?? '')
const eventSlug = String(route.params.event ?? '')
</script>

<template>
  <EmbedBookingFrame
    mode="team"
    :owner="team"
    :slug="eventSlug"
  />
</template>
