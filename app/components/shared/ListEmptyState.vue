<script setup lang="ts">
withDefaults(defineProps<{
  icon?: string
  title: string
  description: string
}>(), {
  icon: 'i-lucide-inbox'
})
</script>

<template>
  <div class="px-6 py-16 text-center sm:py-20">
    <span class="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
      <UIcon
        :name="icon"
        class="size-5"
      />
    </span>
    <h2 class="mt-5 text-[17px] font-semibold text-highlighted">
      {{ title }}
    </h2>
    <p class="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-muted">
      {{ description }}
    </p>
    <div
      v-if="$slots.action"
      class="mt-6"
    >
      <slot name="action" />
    </div>
  </div>
</template>
