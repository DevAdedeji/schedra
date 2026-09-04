<script setup lang="ts">
// Fetch at runtime: prerendered marketing pages must not retain an old billing mode.
const { data } = await useFetch<{ mode: 'sandbox' | 'live' | 'disabled' }>('/api/payment-environment', {
  key: 'payment-environment',
  server: false
})
</script>

<template>
  <div
    v-if="data?.mode === 'sandbox'"
    role="note"
    aria-label="Sandbox payments"
    class="flex items-start gap-3 rounded-xl border border-info/25 bg-info/5 px-4 py-3 text-sm text-highlighted"
  >
    <UIcon
      name="i-lucide-flask-conical"
      class="mt-0.5 size-4 shrink-0 text-info"
    />
    <p class="min-w-0 leading-relaxed">
      <strong class="font-semibold">Sandbox payments.</strong>
      Checkouts here are demonstrations, not real charges. Use only Bachs test payment details.
      Booking emails and calendar invitations can still be real—use your own test accounts.
    </p>
  </div>
</template>
