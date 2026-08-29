<script setup lang="ts">
defineProps<{ hint?: string }>()
</script>

<template>
  <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:gap-3">
    <div class="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
      <slot name="cancel" />
    </div>

    <p
      v-if="hint"
      class="hidden min-w-0 flex-1 truncate text-center text-[13px] text-muted sm:block"
    >
      {{ hint }}
    </p>

    <div class="flex shrink-0 flex-col gap-2 sm:ml-auto sm:flex-row sm:items-center">
      <slot name="actions" />
    </div>
  </div>
</template>
