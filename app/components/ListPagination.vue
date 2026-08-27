<script setup lang="ts">
withDefaults(defineProps<{ page: number, totalPages: number, total: number, disabled?: boolean }>(), {
  disabled: false
})
const emit = defineEmits<{ change: [page: number] }>()
</script>

<template>
  <div
    v-if="totalPages > 1"
    class="surface-secondary flex items-center justify-between gap-3 border-t border-default px-4 py-3 sm:px-5"
    :class="disabled && 'cursor-wait opacity-60'"
    :aria-busy="disabled"
  >
    <p class="text-[11px] text-muted">
      {{ total }} results · Page {{ page }} of {{ totalPages }}
    </p>
    <div class="flex items-center gap-1">
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        icon="i-lucide-chevron-left"
        class="size-7 justify-center p-0"
        :ui="{ leadingIcon: 'size-4' }"
        :disabled="disabled || page <= 1"
        aria-label="Previous page"
        @click="emit('change', page - 1)"
      />
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        icon="i-lucide-chevron-right"
        class="size-7 justify-center p-0"
        :ui="{ leadingIcon: 'size-4' }"
        :disabled="disabled || page >= totalPages"
        aria-label="Next page"
        @click="emit('change', page + 1)"
      />
    </div>
  </div>
</template>
