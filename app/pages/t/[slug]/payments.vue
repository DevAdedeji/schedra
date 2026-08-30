<script setup lang="ts">
definePageMeta({ layout: 'app', middleware: 'auth' })
const route = useRoute()
const slug = computed(() => String(route.params.slug ?? ''))
useSeoMeta({ title: 'Team payments', robots: 'noindex, nofollow' })
</script>

<template>
  <PaymentAccountManager :team-slug="slug" />
</template>
