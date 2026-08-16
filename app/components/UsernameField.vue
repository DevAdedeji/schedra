<script setup lang="ts">
const model = defineModel<string>({ required: true })

withDefaults(defineProps<{
  prefix?: string
  placeholder?: string
  state?: 'ok' | 'bad' | 'busy' | null
}>(), {
  prefix: 'schedra.com/',
  placeholder: 'ada',
  state: null
})

const focused = ref(false)
</script>

<template>
  <div
    class="flex w-full items-stretch overflow-hidden rounded-lg border transition-colors"
    :class="focused
      ? 'border-primary ring-2 ring-primary/20'
      : 'border-accented hover:border-inverted/20'"
  >
    <span class="flex shrink-0 select-none items-center border-r border-accented bg-muted px-3 text-[14px] leading-none text-muted">
      {{ prefix }}
    </span>

    <input
      v-model="model"
      type="text"
      autocomplete="off"
      autocapitalize="none"
      spellcheck="false"
      :placeholder="placeholder"
      class="min-w-0 flex-1 bg-default px-3 py-3 text-[15px] text-highlighted outline-none placeholder:text-dimmed"
      v-bind="$attrs"
      @focus="focused = true"
      @blur="focused = false"
    >

    <span
      v-if="state"
      class="flex shrink-0 items-center bg-default pr-3"
    >
      <UIcon
        v-if="state === 'ok'"
        name="i-lucide-check"
        class="size-4 text-green-600 dark:text-green-500"
      />
      <UIcon
        v-else-if="state === 'bad'"
        name="i-lucide-x"
        class="size-4 text-red-600 dark:text-red-500"
      />
      <UIcon
        v-else
        name="i-lucide-loader-circle"
        class="size-4 animate-spin text-dimmed"
      />
    </span>
  </div>
</template>
