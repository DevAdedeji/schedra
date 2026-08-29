<script setup lang="ts">
const props = withDefaults(defineProps<{
  page: number
  totalPages: number
  total: number
  pageSize?: number
  disabled?: boolean
}>(), {
  pageSize: undefined,
  disabled: false
})
const emit = defineEmits<{ change: [page: number] }>()

// Ranges only make sense when the caller knows its page size; without it the
// bare total is still honest.
const summary = computed(() => {
  if (!props.pageSize) return `${props.total} ${props.total === 1 ? 'result' : 'results'}`
  const first = (props.page - 1) * props.pageSize + 1
  const last = Math.min(props.page * props.pageSize, props.total)
  return `${first}–${last} of ${props.total}`
})

/**
 * First and last page are always reachable, the current page keeps a neighbour
 * on each side, and everything skipped collapses into a gap marker.
 */
const pages = computed<Array<number | 'gap'>>(() => {
  const { page, totalPages } = props
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1)

  const window = new Set([1, totalPages, page, page - 1, page + 1])
  if (page <= 3) [2, 3, 4].forEach(value => window.add(value))
  if (page >= totalPages - 2) [totalPages - 1, totalPages - 2, totalPages - 3].forEach(value => window.add(value))

  const visible = [...window].filter(value => value >= 1 && value <= totalPages).sort((a, b) => a - b)
  return visible.flatMap((value, index) => (
    index > 0 && value - visible[index - 1]! > 1 ? ['gap' as const, value] : [value]
  ))
})

function go(next: number) {
  if (props.disabled || next === props.page || next < 1 || next > props.totalPages) return
  emit('change', next)
}
</script>

<template>
  <nav
    v-if="totalPages > 1"
    class="surface-secondary flex items-center justify-between gap-3 border-t border-default px-4 py-3 sm:px-5"
    :class="disabled && 'cursor-wait opacity-60'"
    :aria-busy="disabled"
    aria-label="Pagination"
  >
    <p class="tnum shrink-0 text-[12px] text-muted">
      {{ summary }}
    </p>

    <div class="flex items-center gap-0.5">
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        icon="i-lucide-chevron-left"
        class="size-8 justify-center p-0"
        :ui="{ leadingIcon: 'size-4' }"
        :disabled="disabled || page <= 1"
        aria-label="Previous page"
        @click="go(page - 1)"
      />

      <p class="tnum px-2 text-[12px] font-medium text-toned sm:hidden">
        {{ page }} / {{ totalPages }}
      </p>

      <template
        v-for="(entry, index) in pages"
        :key="`${entry}-${index}`"
      >
        <span
          v-if="entry === 'gap'"
          class="hidden size-8 items-center justify-center text-[12px] text-dimmed sm:flex"
          aria-hidden="true"
        >…</span>
        <button
          v-else
          type="button"
          class="tnum hidden size-8 shrink-0 items-center justify-center rounded-lg text-[12px] font-medium transition-colors sm:flex"
          :class="entry === page
            ? 'bg-inverted text-inverted'
            : 'text-muted hover:bg-elevated hover:text-highlighted'"
          :disabled="disabled"
          :aria-label="`Page ${entry}`"
          :aria-current="entry === page ? 'page' : undefined"
          @click="go(entry)"
        >
          {{ entry }}
        </button>
      </template>

      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        icon="i-lucide-chevron-right"
        class="size-8 justify-center p-0"
        :ui="{ leadingIcon: 'size-4' }"
        :disabled="disabled || page >= totalPages"
        aria-label="Next page"
        @click="go(page + 1)"
      />
    </div>
  </nav>
</template>
