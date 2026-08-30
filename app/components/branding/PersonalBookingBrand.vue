<script setup lang="ts">
import type { PublicPersonalBranding } from '#shared/branding'

defineProps<{
  branding?: PublicPersonalBranding
}>()
</script>

<template>
  <span
    v-if="branding?.logoUrl || branding?.brandName"
    class="inline-flex min-h-8 items-center gap-3"
  >
    <img
      v-if="branding.logoUrl"
      :src="branding.logoUrl"
      :alt="branding.brandName ? `${branding.brandName} logo` : 'Booking page logo'"
      class="max-h-10 max-w-44 object-contain object-left"
    >
    <span
      v-if="branding.brandName"
      class="text-[16px] font-semibold tracking-[-0.02em] text-highlighted"
    >{{ branding.brandName }}</span>
  </span>
  <SchedraMark v-else />
</template>
