<script setup lang="ts">
const props = withDefaults(defineProps<{
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  confirmColor?: 'primary' | 'error'
  loading?: boolean
}>(), {
  description: '',
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  confirmColor: 'primary',
  loading: false
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  'confirm': []
}>()

const isOpen = computed({ get: () => props.open, set: value => emit('update:open', value) })
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :title="title"
    :description="description"
    :ui="{ content: 'w-full max-w-md', footer: 'border-t border-default px-5 py-4 sm:px-6' }"
  >
    <template
      v-if="$slots.body"
      #body
    >
      <slot name="body" />
    </template>
    <template #footer>
      <ModalFooter>
        <template #cancel>
          <UButton
            color="neutral"
            variant="soft"
            :disabled="loading"
            @click="isOpen = false"
          >
            {{ cancelLabel }}
          </UButton>
        </template>
        <template #actions>
          <slot name="actions">
            <UButton
              :color="confirmColor"
              :loading="loading"
              @click="emit('confirm')"
            >
              {{ confirmLabel }}
            </UButton>
          </slot>
        </template>
      </ModalFooter>
    </template>
  </UModal>
</template>
