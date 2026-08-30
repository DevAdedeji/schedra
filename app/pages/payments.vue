<script setup lang="ts">
definePageMeta({ layout: 'app', middleware: 'auth' })
useSeoMeta({ title: 'Payments', robots: 'noindex, nofollow' })
</script>

<template>
  <PaymentAccountManager />
</template>
