<script setup lang="ts">
import {
  apiErrorMessage,
  teamEventTypesApi,
  type TeamEventTypeDetail,
  type TeamEventTypeRecord
} from '~/services/schedra-api'

const props = defineProps<{
  open: boolean
  teamSlug: string
  eventType: TeamEventTypeRecord | null
}>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': []
}>()

const isOpen = computed({ get: () => props.open, set: value => emit('update:open', value) })
const detail = ref<TeamEventTypeDetail | null>(null)
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const feedback = useFeedback()

const editableFields = computed(() => new Set(detail.value?.managed?.memberEditableFields ?? []))

watch(() => props.open, async (open) => {
  if (!open || !props.eventType) return
  loading.value = true
  error.value = ''
  detail.value = null
  try {
    detail.value = await teamEventTypesApi.get(props.teamSlug, props.eventType.id)
  } catch (failure) {
    error.value = apiErrorMessage(failure, 'Could not load this managed event.')
  } finally {
    loading.value = false
  }
})

async function save() {
  if (!detail.value || saving.value || !props.eventType) return
  saving.value = true
  error.value = ''
  try {
    await teamEventTypesApi.update(props.teamSlug, props.eventType.id, detail.value)
    feedback.success({ title: 'Managed link personalized' })
    emit('saved')
    isOpen.value = false
  } catch (failure) {
    error.value = apiErrorMessage(failure, 'Could not save your changes.')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :dismissible="false"
    title="Personalize managed link"
    :description="eventType?.managed ? `${eventType.managed.templateName} controls the scheduling rules. You can change only the fields your team allows.` : ''"
    :ui="{ content: 'w-[min(95vw,34rem)] max-w-lg', footer: 'border-t border-default px-5 py-4 sm:px-6' }"
  >
    <template #body>
      <ListLoadingSkeleton
        v-if="loading"
        label="Loading managed event"
      />
      <AsyncErrorState
        v-else-if="error && !detail"
        title="Could not load managed event"
        :description="error"
      />
      <form
        v-else-if="detail"
        id="managed-event-personalization-form"
        class="space-y-4"
        @submit.prevent="save"
      >
        <UFormField
          v-if="editableFields.has('description')"
          label="Description"
          help="Shown to guests before they choose a time."
        >
          <UTextarea
            v-model="detail.description"
            :rows="3"
            maxlength="1000"
            class="w-full"
          />
        </UFormField>
        <UFormField
          v-if="editableFields.has('locationDetails')"
          label="Meeting details"
          help="Use your own address, phone instructions or meeting information."
        >
          <UInput
            v-model="detail.locationDetails"
            maxlength="500"
            class="w-full"
          />
        </UFormField>
        <div
          v-if="editableFields.has('hidden')"
          class="flex items-center justify-between gap-4 rounded-lg border border-default px-4 py-3"
        >
          <div>
            <p class="text-[13px] font-medium text-highlighted">
              Hide booking link
            </p>
            <p class="mt-0.5 text-[12px] text-muted">
              Pause new bookings without changing the team template.
            </p>
          </div>
          <USwitch v-model="detail.hidden" />
        </div>
        <p
          v-if="error"
          class="text-[13px] text-error"
          role="alert"
        >
          {{ error }}
        </p>
      </form>
    </template>
    <template #footer>
      <ModalFooter>
        <template #cancel>
          <UButton
            color="neutral"
            variant="soft"
            :disabled="saving"
            @click="isOpen = false"
          >
            Cancel
          </UButton>
        </template>
        <template #actions>
          <UButton
            type="submit"
            form="managed-event-personalization-form"
            :loading="saving"
            :disabled="!detail"
          >
            Save changes
          </UButton>
        </template>
      </ModalFooter>
    </template>
  </UModal>
</template>
