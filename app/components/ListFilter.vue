<script setup lang="ts">
interface FilterOption {
  value: string
  label: string
  count: number
}

defineProps<{ options: FilterOption[] }>()
const model = defineModel<string>({ required: true })
</script>

<template>
  <div
    class="flex gap-1 overflow-x-auto"
    role="tablist"
    aria-label="Filter list"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="tab"
      :aria-selected="model === option.value"
      class="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-[12px] font-medium transition-colors sm:gap-2 sm:px-3 sm:text-[13px]"
      :class="model === option.value
        ? 'bg-elevated text-highlighted'
        : 'text-muted hover:bg-muted hover:text-highlighted'"
      @click="model = option.value"
    >
      {{ option.label }}
      <span
        class="tnum rounded-md px-1.5 py-0.5 text-[10px]"
        :class="model === option.value ? 'bg-default text-toned' : 'bg-muted text-dimmed'"
      >
        {{ option.count }}
      </span>
    </button>
  </div>
</template>
