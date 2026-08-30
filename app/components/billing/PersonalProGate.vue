<script setup lang="ts">
withDefaults(defineProps<{
  title: string
  description: string
}>(), {})
</script>

<template>
  <section class="overflow-hidden rounded-2xl border border-primary/25 bg-default">
    <div class="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
      <div class="flex min-w-0 gap-4">
        <span class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <UIcon
            name="i-lucide-sparkles"
            class="size-5"
          />
        </span>
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="text-[17px] font-semibold text-highlighted">
              {{ title }}
            </h2>
            <UBadge
              color="primary"
              variant="subtle"
            >
              Personal Pro
            </UBadge>
          </div>
          <p class="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-muted">
            {{ description }}
          </p>
        </div>
      </div>
      <UButton
        to="/billing"
        icon="i-lucide-arrow-up-right"
        class="shrink-0 rounded-full px-5 font-medium"
      >
        Upgrade for $6/month
      </UButton>
    </div>
  </section>
</template>
