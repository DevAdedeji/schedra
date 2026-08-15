<script setup lang="ts">
/**
 * A calendar cell quartered by the grid, with the bottom-right slot claimed.
 *
 * `tile` is the canonical mark — solid vermillion, legible standalone at any
 * size on a background we don't control. It matches public/favicon.ico exactly.
 *
 * `line` is the hairline drawing: lighter, borrows the page's ink, and reads
 * better at large sizes or anywhere a solid block would overpower. Kept for
 * print-like or oversized contexts.
 */
withDefaults(defineProps<{
  wordmark?: boolean
  variant?: 'tile' | 'line'
}>(), {
  wordmark: true,
  variant: 'tile'
})
</script>

<template>
  <span class="inline-flex items-center gap-2.5">
    <svg
      viewBox="0 0 48 48"
      class="size-[18px] shrink-0"
      aria-hidden="true"
    >
      <template v-if="variant === 'tile'">
        <rect
          width="48"
          height="48"
          class="fill-primary"
        />
        <path
          d="M21 3h6v42h-6zM3 21h42v6H3z"
          fill="#fff"
        />
        <rect
          x="27"
          y="27"
          width="18"
          height="18"
          fill="#fff"
        />
      </template>

      <template v-else>
        <path
          fill-rule="evenodd"
          d="M0 0h48v48H0zM3 3v42h42V3z"
          class="fill-current text-highlighted"
        />
        <path
          d="M22 3h3v42h-3zM3 22h42v3H3z"
          class="fill-current text-highlighted"
        />
        <rect
          x="25"
          y="25"
          width="20"
          height="20"
          class="fill-primary"
        />
      </template>
    </svg>

    <span
      v-if="wordmark"
      class="text-[15px] font-semibold tracking-[-0.03em] text-highlighted"
    >schedra</span>
  </span>
</template>
