<script setup lang="ts">
definePageMeta({ layout: 'app', middleware: ['auth', 'platform-admin'] })
useSeoMeta({ title: 'Payments · Control', robots: 'noindex, nofollow' })
</script>

<template>
  <div>
    <ControlNavigation />
    <PageHeader
      title="Payments"
      description="Review booking payments, refunds, settlements and recovery state."
    />
    <div class="mt-7">
      <PaymentActivityList operations />
    </div>
  </div>
</template>
