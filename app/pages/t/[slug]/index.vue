<script setup lang="ts">
definePageMeta({
  layout: 'app',
  middleware: 'auth',
  // Members is the workspace landing page until team scheduling lands.
  redirect: to => `/w/${to.params.slug}/members`
})
</script>

<template>
  <div />
</template>
