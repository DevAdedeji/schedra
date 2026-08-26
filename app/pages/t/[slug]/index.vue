<script setup lang="ts">
definePageMeta({
  layout: 'app',
  middleware: 'auth',
  // Members is the team landing page until team scheduling lands.
  redirect: to => `/t/${to.params.slug}/members`
})
</script>

<template>
  <div />
</template>
