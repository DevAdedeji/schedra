<script setup lang="ts">
withDefaults(defineProps<{ wordmark?: boolean }>(), { wordmark: true })
</script>

<template>
  <span class="inline-flex items-center gap-2.5">
    <!-- A calendar cell quartered by the grid, with one slot claimed.
         The whole design system in 24 pixels. -->
    <svg
      viewBox="0 0 24 24"
      class="size-[18px] shrink-0 text-highlighted"
      aria-hidden="true"
    >
      <rect
        x="0.75"
        y="0.75"
        width="22.5"
        height="22.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      />
      <path
        d="M0 12h24M12 0v24"
        stroke="currentColor"
        stroke-width="1.5"
      />
      <rect
        x="12.75"
        y="12.75"
        width="10.5"
        height="10.5"
        class="fill-primary"
      />
    </svg>
    <span
      v-if="wordmark"
      class="text-[15px] font-semibold tracking-[-0.03em] text-highlighted"
    >schedra</span>
  </span>
</template>
