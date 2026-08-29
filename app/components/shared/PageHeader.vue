<script setup lang="ts">
defineProps<{
  title: string
  description?: string
}>()
</script>

<template>
  <header class="flex items-start flex-wrap sm:flex-nowrap sm:items-center justify-between gap-4 border-b border-default pb-6">
    <div class="min-w-0">
      <h1 class="text-2xl font-semibold tracking-tight text-highlighted">
        {{ title }}
      </h1>
      <p
        v-if="description"
        class="mt-1.5 text-[14px] text-muted"
      >
        {{ description }}
      </p>
    </div>

    <div
      v-if="$slots.actions"
      class="page-header-actions flex shrink-0 items-center justify-end gap-2 sm:justify-self-end"
    >
      <slot name="actions" />
    </div>
  </header>
</template>
