<script setup lang="ts">
withDefaults(defineProps<{
  wordmark?: boolean
  variant?: 'tile' | 'line'
  inverted?: boolean
}>(), {
  wordmark: true,
  variant: 'tile',
  inverted: false
})
</script>

<template>
  <span class="inline-flex items-center gap-2.5">
    <svg
      viewBox="0 0 48 48"
      class="size-4.5 shrink-0"
      aria-hidden="true"
    >
      <template v-if="variant === 'tile'">
        <rect
          width="48"
          height="48"
          :class="inverted ? 'fill-white' : 'fill-primary'"
        />
        <path
          d="M21 3h6v42h-6zM3 21h42v6H3z"
          :class="inverted ? 'fill-primary' : 'fill-white'"
        />
        <rect
          x="27"
          y="27"
          width="18"
          height="18"
          :class="inverted ? 'fill-primary' : 'fill-white'"
        />
      </template>

      <template v-else>
        <path
          fill-rule="evenodd"
          d="M0 0h48v48H0zM3 3v42h42V3z"
          :class="inverted ? 'fill-white' : 'fill-current text-highlighted'"
        />
        <path
          d="M22 3h3v42h-3zM3 22h42v3H3z"
          :class="inverted ? 'fill-white' : 'fill-current text-highlighted'"
        />
        <rect
          x="25"
          y="25"
          width="20"
          height="20"
          :class="inverted ? 'fill-white' : 'fill-primary'"
        />
      </template>
    </svg>

    <span
      v-if="wordmark"
      class="text-[16px] font-semibold tracking-[-0.03em]"
      :class="inverted ? 'text-white' : 'text-highlighted'"
    >schedra</span>
  </span>
</template>
