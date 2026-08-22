<script setup lang="ts">
withDefaults(defineProps<{
  title?: string
  description?: string
  compact?: boolean
  retrying?: boolean
}>(), {
  title: 'Could not load this content',
  description: 'Check your connection and try again.',
  compact: false,
  retrying: false
})

const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div
    role="alert"
    aria-live="assertive"
    :class="compact
      ? 'flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5'
      : 'flex min-h-64 flex-col items-center justify-center px-6 py-14 text-center sm:py-16'"
  >
    <div
      class="flex items-start gap-3"
      :class="!compact && 'flex-col items-center'"
    >
      <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-error/10 text-error">
        <UIcon
          name="i-lucide-cloud-alert"
          class="size-4.5"
        />
      </span>
      <div :class="!compact && 'max-w-sm'">
        <h2 class="text-[14px] font-semibold text-highlighted">
          {{ title }}
        </h2>
        <p class="mt-1 text-[12px] leading-relaxed text-muted">
          {{ description }}
        </p>
      </div>
    </div>

    <UButton
      color="neutral"
      variant="outline"
      size="sm"
      icon="i-lucide-refresh-cw"
      :loading="retrying"
      class="min-h-11 shrink-0 sm:min-h-8"
      @click="emit('retry')"
    >
      Try again
    </UButton>
  </div>
</template>
