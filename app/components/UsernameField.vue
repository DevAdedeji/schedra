<script setup lang="ts">
import { useFormField } from '@nuxt/ui/composables'

defineOptions({ inheritAttrs: false })

const model = defineModel<string>({ required: true })

const props = withDefaults(defineProps<{
  id?: string
  name?: string
  disabled?: boolean
  prefix?: string
  placeholder?: string
  state?: 'ok' | 'bad' | 'busy' | null
}>(), {
  prefix: 'schedra.com/',
  placeholder: 'ada',
  state: null
})

const focused = ref(false)
const {
  id,
  name,
  disabled,
  color,
  ariaAttrs,
  emitFormBlur,
  emitFormChange,
  emitFormFocus,
  emitFormInput
} = useFormField(props, { deferInputValidation: true })
</script>

<template>
  <div
    class="flex w-full items-stretch overflow-hidden rounded-lg border transition-colors"
    :class="color === 'error'
      ? 'border-error ring-2 ring-error/20'
      : focused
        ? 'border-primary ring-2 ring-primary/20'
        : 'border-accented hover:border-inverted/20'"
  >
    <span class="flex shrink-0 select-none items-center border-r border-accented bg-muted px-3 text-[14px] leading-none text-muted">
      {{ prefix }}
    </span>

    <input
      :id="id"
      v-model="model"
      type="text"
      :name="name"
      :disabled="disabled"
      autocomplete="off"
      autocapitalize="none"
      spellcheck="false"
      :placeholder="placeholder"
      class="min-w-0 flex-1 bg-default px-3 py-3 text-[15px] text-highlighted outline-none placeholder:text-dimmed"
      v-bind="{ ...ariaAttrs, ...$attrs }"
      @input="emitFormInput"
      @change="emitFormChange"
      @focus="focused = true; emitFormFocus()"
      @blur="focused = false; emitFormBlur()"
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
