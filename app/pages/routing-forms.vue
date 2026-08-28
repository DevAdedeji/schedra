<script setup lang="ts">
definePageMeta({ layout: 'app', middleware: 'auth' })
useSeoMeta({ title: 'Routing forms', robots: 'noindex, nofollow' })
</script>

<template>
  <RoutingFormsManager :can-manage="true" />
</template>
