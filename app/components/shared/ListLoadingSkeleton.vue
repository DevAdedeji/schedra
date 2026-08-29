<script setup lang="ts">
withDefaults(defineProps<{
  rows?: number
  variant?: 'records' | 'bookings'
  label?: string
}>(), {
  rows: 3,
  variant: 'records',
  label: 'Loading results'
})
</script>

<template>
  <div
    :aria-label="label"
    aria-busy="true"
    role="status"
  >
    <div
      v-if="variant === 'bookings'"
      class="space-y-3 p-5 sm:p-6"
      aria-hidden="true"
    >
      <USkeleton class="h-3 w-32 rounded" />
      <div
        v-for="index in rows"
        :key="index"
        class="flex items-start gap-4 rounded-xl border border-default p-4 sm:p-5"
      >
        <USkeleton class="size-10 shrink-0 rounded-full" />
        <div class="min-w-0 flex-1 space-y-2.5">
          <USkeleton
            class="h-4 rounded"
            :class="index % 2 ? 'w-36' : 'w-44'"
          />
          <USkeleton class="h-3 w-48 max-w-full rounded" />
          <USkeleton class="h-3 w-64 max-w-[85%] rounded" />
        </div>
        <USkeleton class="hidden h-8 w-16 shrink-0 rounded-lg sm:block" />
      </div>
    </div>

    <div
      v-else
      class="divide-y divide-default"
      aria-hidden="true"
    >
      <div
        v-for="index in rows"
        :key="index"
        class="flex items-start gap-4 px-4 py-5 sm:gap-5 sm:px-5"
      >
        <USkeleton class="size-11 shrink-0 rounded-xl" />
        <div class="min-w-0 flex-1 space-y-3">
          <div class="flex items-center gap-2">
            <USkeleton
              class="h-4 rounded"
              :class="index % 2 ? 'w-40' : 'w-52'"
            />
            <USkeleton class="h-5 w-14 rounded-full" />
          </div>
          <USkeleton class="h-3 w-full max-w-xl rounded" />
          <div class="flex gap-3">
            <USkeleton class="h-3 w-20 rounded" />
            <USkeleton class="h-3 w-24 rounded" />
            <USkeleton class="hidden h-3 w-28 rounded sm:block" />
          </div>
        </div>
        <div class="flex shrink-0 gap-1">
          <USkeleton class="size-7 rounded-lg" />
          <USkeleton class="size-7 rounded-lg" />
        </div>
      </div>
    </div>
  </div>
</template>
