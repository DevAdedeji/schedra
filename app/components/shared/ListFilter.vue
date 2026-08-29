<script setup lang="ts">
interface FilterOption {
  value: string
  label: string
  count?: number
}

withDefaults(defineProps<{ options: FilterOption[], disabled?: boolean, label?: string }>(), {
  disabled: false,
  label: 'Filter list'
})
const model = defineModel<string>({ required: true })
</script>

<template>
  <div
    class="flex gap-1 overflow-x-auto"
    role="tablist"
    :aria-label="label"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="tab"
      :aria-selected="model === option.value"
      :disabled="disabled"
      class="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors sm:gap-2 sm:px-3 sm:text-[14px]"
      :class="[
        model === option.value
          ? 'bg-elevated text-highlighted'
          : 'text-muted hover:bg-muted hover:text-highlighted',
        disabled && 'cursor-wait opacity-60'
      ]"
      @click="model = option.value"
    >
      {{ option.label }}
      <span
        v-if="option.count !== undefined"
        class="tnum rounded-md px-1.5 py-0.5 text-[12px]"
        :class="model === option.value ? 'bg-default text-toned' : 'bg-muted text-dimmed'"
      >
        {{ option.count }}
      </span>
    </button>
  </div>
</template>
