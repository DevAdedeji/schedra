<script setup lang="ts">
defineOptions({ inheritAttrs: false })

const model = defineModel<string>({ required: true })

withDefaults(defineProps<{
  autocomplete?: string
  placeholder?: string
  size?: 'lg' | 'xl'
  autofocus?: boolean
}>(), {
  autocomplete: 'current-password',
  placeholder: 'Your password',
  size: 'xl',
  autofocus: false
})

const revealed = ref(false)

// Revealing is deliberately not sticky: a shoulder-surfer benefits from it far
// more than the person typing, so every field starts hidden.
function toggle() {
  revealed.value = !revealed.value
}
</script>

<template>
  <UInput
    v-model="model"
    :type="revealed ? 'text' : 'password'"
    :size="size"
    :autocomplete="autocomplete"
    :placeholder="placeholder"
    :autofocus="autofocus"
    class="w-full"
    v-bind="$attrs"
  >
    <template #trailing>
      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        size="xs"
        :icon="revealed ? 'i-lucide-eye-off' : 'i-lucide-eye'"
        :aria-label="revealed ? 'Hide password' : 'Show password'"
        :aria-pressed="revealed"
        tabindex="-1"
        class="-me-1.5"
        @click="toggle"
      />
    </template>
  </UInput>
</template>
