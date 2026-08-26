<script setup lang="ts">
definePageMeta({ layout: 'bare' })

const route = useRoute()
const username = String(route.params.username ?? '')
const slug = String(route.params.slug ?? '')
</script>

<template>
  <EmbedBookingFrame
    mode="personal"
    :owner="username"
    :slug="slug"
  />
</template>
