<script setup lang="ts">
/**
 * The page IS a calendar. Every section is a band of the same grid: hairline
 * rules on a fixed `--row` rhythm, an hour rail pinned to the left gutter, and
 * content that sits in the remaining columns the way events sit in a schedule.
 *
 * The rail labels and the rules are both laid out against `--row`, so they can
 * never drift out of alignment no matter how the content reflows.
 */
withDefaults(defineProps<{
  /** Hour labels for the left rail. They run consecutively across sections so
   *  the whole page reads as one uninterrupted day. */
  rail?: string[]
  /** Draw the repeating horizontal hairlines. */
  rules?: boolean
  /** Tint the band to separate it from its neighbours. */
  muted?: boolean
}>(), {
  rail: () => [],
  rules: true,
  muted: false
})
</script>

<template>
  <section
    class="relative border-b border-default"
    :class="muted && 'bg-muted'"
  >
    <div class="relative mx-auto max-w-[100rem]">
      <div
        v-if="rules"
        class="rules pointer-events-none absolute inset-0"
        aria-hidden="true"
      />

      <!-- Vertical hairlines: the rail gutter, and the container edges. -->
      <div
        class="pointer-events-none absolute inset-0 hidden md:block"
        aria-hidden="true"
      >
        <div class="absolute inset-y-0 left-[var(--rail)] w-px bg-border" />
        <div class="absolute inset-y-0 right-0 w-px bg-border" />
      </div>

      <div
        v-if="rail.length"
        class="pointer-events-none absolute inset-y-0 left-0 hidden w-[var(--rail)] md:block"
        aria-hidden="true"
      >
        <div
          v-for="hour in rail"
          :key="hour"
          class="tnum h-[var(--row)] pr-3.5 pt-2 text-right font-mono text-[10px] tracking-[0.16em] text-dimmed"
        >
          {{ hour }}
        </div>
      </div>

      <div class="relative px-5 sm:px-6 md:pl-[calc(var(--rail)+3rem)] md:pr-12">
        <slot />
      </div>
    </div>
  </section>
</template>

<style scoped>
.rules {
  background-image: repeating-linear-gradient(
    to bottom,
    var(--ui-border) 0 1px,
    transparent 1px var(--row)
  );
}
</style>
