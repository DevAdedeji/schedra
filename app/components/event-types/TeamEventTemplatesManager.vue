<script setup lang="ts">
import {
  apiErrorMessage,
  teamEventTemplatesApi,
  type TeamEventTemplateRecord,
  type TeamEventTemplatesResponse
} from '~/services/schedra-api'

const props = defineProps<{ teamSlug: string, refreshKey?: number }>()
const feedback = useFeedback()
const endpoint = computed(() => teamEventTemplatesApi.listEndpoint(props.teamSlug))
const { data, status, error, refresh } = await useLazyFetch<TeamEventTemplatesResponse>(endpoint)
watch(() => props.refreshKey, (next, previous) => {
  if (previous !== undefined && next !== previous) refresh()
})

const modalOpen = ref(false)
const editing = ref<TeamEventTemplateRecord | null>(null)
const name = ref('')
const sourceEventTypeId = ref<string | undefined>()
const saving = ref(false)
const saveError = ref('')
const archiving = ref<TeamEventTemplateRecord | null>(null)
const archiveBusy = ref(false)

const sourceOptions = computed(() => (data.value?.sourceEventTypes ?? []).map(item => ({
  label: `${item.title} · ${item.durationMinutes} min`,
  value: item.id
})))
const canSave = computed(() => Boolean(name.value.trim() && sourceEventTypeId.value))

function openCreate() {
  editing.value = null
  name.value = ''
  sourceEventTypeId.value = undefined
  saveError.value = ''
  modalOpen.value = true
}

function openEdit(template: TeamEventTemplateRecord) {
  editing.value = template
  name.value = template.name
  sourceEventTypeId.value = template.sourceEventTypeId ?? undefined
  saveError.value = ''
  modalOpen.value = true
}

async function save() {
  if (!canSave.value || saving.value || !sourceEventTypeId.value) return
  saving.value = true
  saveError.value = ''
  try {
    const body = { name: name.value.trim(), sourceEventTypeId: sourceEventTypeId.value }
    if (editing.value) await teamEventTemplatesApi.update(props.teamSlug, editing.value.id, body)
    else await teamEventTemplatesApi.create(props.teamSlug, body)
    feedback.success({
      title: editing.value ? 'Template updated' : 'Template created',
      description: 'Existing event types were not changed.'
    })
    modalOpen.value = false
    await refresh()
  } catch (failure) {
    saveError.value = apiErrorMessage(failure, 'Could not save that template.')
  } finally {
    saving.value = false
  }
}

async function archive() {
  if (!archiving.value || archiveBusy.value) return
  archiveBusy.value = true
  try {
    await teamEventTemplatesApi.archive(props.teamSlug, archiving.value.id)
    feedback.success({ title: 'Template archived', description: 'Event types already created from it are unchanged.' })
    archiving.value = null
    await refresh()
  } catch (failure) {
    feedback.error({ title: 'Could not archive template', description: apiErrorMessage(failure, 'Please try again.') })
  } finally {
    archiveBusy.value = false
  }
}
</script>

<template>
  <section class="overflow-hidden rounded-xl border border-default bg-default">
    <header class="flex flex-col gap-3 border-b border-default px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div>
        <h2 class="text-[15px] font-semibold text-highlighted">
          Managed templates
        </h2>
        <p class="mt-1 text-[13px] leading-relaxed text-muted">
          Reuse approved event defaults. A template is copied when selected, so later template edits never change existing links.
        </p>
      </div>
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-layout-template"
        class="shrink-0 self-start sm:self-auto"
        :disabled="!data?.sourceEventTypes.length"
        :title="data?.sourceEventTypes.length ? 'Create a managed template' : 'Create a team event type first'"
        @click="openCreate"
      >
        New template
      </UButton>
    </header>

    <AsyncErrorState
      v-if="error && !data"
      title="Could not load templates"
      description="Event types are still available."
      @retry="refresh"
    />
    <ListLoadingSkeleton
      v-else-if="status === 'pending' && !data"
      label="Loading templates"
    />
    <div
      v-else-if="!data?.items.length"
      class="px-5 py-7 text-center"
    >
      <UIcon
        name="i-lucide-layout-template"
        class="mx-auto size-5 text-dimmed"
      />
      <p class="mt-2 text-[14px] font-medium text-highlighted">
        No managed templates yet
      </p>
      <p class="mx-auto mt-1 max-w-md text-[13px] leading-relaxed text-muted">
        Save the settings from an existing team event type, then apply them while creating future links.
      </p>
    </div>
    <ul
      v-else
      class="divide-y divide-default"
    >
      <li
        v-for="template in data.items"
        :key="template.id"
        class="flex items-start gap-4 px-4 py-4 sm:px-5"
      >
        <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <UIcon
            name="i-lucide-layout-template"
            class="size-4"
          />
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-[14px] font-medium text-highlighted">
            {{ template.name }}
          </p>
          <p class="mt-1 text-[12px] text-muted">
            {{ template.defaults.title }} · {{ [template.defaults.durationMinutes, ...template.defaults.additionalDurationMinutes].join(' / ') }} min
          </p>
        </div>
        <div class="flex shrink-0 gap-1">
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-pencil"
            :aria-label="`Edit ${template.name}`"
            @click="openEdit(template)"
          />
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-archive"
            :aria-label="`Archive ${template.name}`"
            @click="archiving = template"
          />
        </div>
      </li>
    </ul>
  </section>

  <UModal
    v-model:open="modalOpen"
    :title="editing ? 'Edit managed template' : 'New managed template'"
    description="Choose an existing event type whose settings should become the reusable defaults."
    :ui="{ content: 'w-[min(95vw,34rem)] max-w-lg', footer: 'border-t border-default px-5 py-4 sm:px-6' }"
  >
    <template #body>
      <form
        id="team-template-form"
        class="space-y-4"
        @submit.prevent="save"
      >
        <UFormField
          label="Template name"
          required
        >
          <UInput
            v-model="name"
            maxlength="80"
            placeholder="Standard discovery call"
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="Copy defaults from"
          required
          help="Hosts, booking link and payment settings are never copied."
        >
          <USelectMenu
            v-model="sourceEventTypeId"
            :items="sourceOptions"
            value-key="value"
            :loading="status === 'pending'"
            placeholder="Choose a team event type"
            class="w-full"
          />
        </UFormField>
        <p class="rounded-lg border border-default bg-muted px-3 py-2.5 text-[12px] leading-relaxed text-muted">
          Updating this template replaces its snapshot for future event types only. Existing event types always keep their current settings.
        </p>
        <p
          v-if="saveError"
          class="text-[13px] text-error"
          role="alert"
        >
          {{ saveError }}
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
            @click="modalOpen = false"
          >
            Cancel
          </UButton>
        </template>
        <template #actions>
          <UButton
            type="submit"
            form="team-template-form"
            :loading="saving"
            :disabled="!canSave"
          >
            {{ editing ? 'Save template' : 'Create template' }}
          </UButton>
        </template>
      </ModalFooter>
    </template>
  </UModal>

  <ConfirmDialog
    :open="Boolean(archiving)"
    title="Archive this template?"
    description="It will no longer appear when creating event types. Existing event types stay exactly as they are."
    confirm-label="Archive template"
    :loading="archiveBusy"
    @update:open="value => { if (!value) archiving = null }"
    @confirm="archive"
  />
</template>
