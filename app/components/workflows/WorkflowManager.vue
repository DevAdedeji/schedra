<script setup lang="ts">
import {
  workflowsApi,
  type EventTypesResponse,
  type TeamEventTypesResponse,
  type WorkflowsResponse
} from '~/services/schedra-api'
import { compactActionMenuUi } from '~/utils/action-menu'
import { DEFAULT_LIST_PAGE_SIZE } from '~/constants/lists'
import { WORKFLOW_OFFSET_OPTIONS, WORKFLOW_RECIPIENT_OPTIONS, WORKFLOW_TRIGGER_OPTIONS } from '~/constants/workflows'

const props = defineProps<{
  teamSlug?: string
  eventTypesEndpoint: string
  canManage: boolean
}>()

const page = ref(1)
const { data, refresh, status, error: loadFailure } = await useLazyFetch<WorkflowsResponse>(
  () => workflowsApi.listEndpoint(props.teamSlug),
  { query: computed(() => ({ page: page.value, pageSize: DEFAULT_LIST_PAGE_SIZE })) }
)

const list = computed(() => data.value?.items ?? [])
const { initialLoading, refreshing } = useListLoadingState(status, data)
const {
  modalOpen, editing, form, saving, formError, secret, secretOpen, copied,
  busyId, deleting, startCreate, startEdit, setActionType, save, toggle, remove,
  triggerLabel, timing, actionLabel, variableToken, copySecret
} = useWorkflowManager({ teamSlug: () => props.teamSlug, refresh })
const triggerOptions = WORKFLOW_TRIGGER_OPTIONS
const offsetOptions = WORKFLOW_OFFSET_OPTIONS
const recipientOptions = WORKFLOW_RECIPIENT_OPTIONS
const {
  query: eventSearchInput,
  search: eventSearch,
  clearSearch: clearEventSearch
} = useDebouncedSearch()

const { data: eventTypes, status: eventTypesStatus, refresh: refreshEventTypes } = await useLazyFetch<EventTypesResponse | TeamEventTypesResponse>(
  () => props.eventTypesEndpoint,
  { query: computed(() => ({ page: 1, pageSize: DEFAULT_LIST_PAGE_SIZE, search: eventSearch.value })), immediate: false }
)

const eventTypeOptions = computed(() => {
  const options = [{ label: 'All event types', value: null as string | null }]
  for (const item of eventTypes.value?.items ?? []) options.push({ label: item.title, value: item.id })
  if (editing.value?.eventTypeId && !options.some(option => option.value === editing.value?.eventTypeId)) {
    options.push({ label: editing.value.eventTypeTitle ?? 'Selected event type', value: editing.value.eventTypeId })
  }
  return options
})

watch(modalOpen, async (open) => {
  if (!open) return
  clearEventSearch()
  await refreshEventTypes()
})
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="Workflows"
      description="Send the right message or webhook when something happens around a booking."
    >
      <template #actions>
        <UButton
          v-if="canManage !== false"
          icon="i-lucide-plus"
          @click="startCreate"
        >
          New workflow
        </UButton>
      </template>
    </PageHeader>

    <section class="overflow-hidden rounded-xl border border-default bg-default">
      <AsyncErrorState
        v-if="loadFailure && !data"
        title="Could not load workflows"
        description="Your automations are safe. Check your connection and try again."
        @retry="refresh"
      />
      <ListLoadingSkeleton
        v-else-if="initialLoading"
        label="Loading workflows"
      />
      <ListEmptyState
        v-else-if="!list.length"
        icon="i-lucide-workflow"
        title="No workflows yet"
        description="Start with a reminder, follow-up email or webhook. You can pause it at any time."
      >
        <template
          v-if="canManage !== false"
          #action
        >
          <UButton
            icon="i-lucide-plus"
            @click="startCreate"
          >
            Create your first workflow
          </UButton>
        </template>
      </ListEmptyState>
      <ul
        v-else
        class="divide-y divide-default"
        :class="refreshing && 'opacity-60'"
      >
        <li
          v-for="workflow in list"
          :key="workflow.id"
          class="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:px-5"
        >
          <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <UIcon
              :name="workflow.action.type === 'email' ? 'i-lucide-mail' : 'i-lucide-webhook'"
              class="size-4"
            />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <p class="truncate text-[15px] font-semibold text-highlighted">
                {{ workflow.name }}
              </p>
              <UBadge
                :color="workflow.active ? 'success' : 'neutral'"
                variant="subtle"
                size="sm"
              >
                {{ workflow.active ? 'Active' : 'Paused' }}
              </UBadge>
            </div>
            <p class="mt-1 text-[13px] leading-relaxed text-muted">
              {{ triggerLabel(workflow.trigger) }} · {{ timing(workflow) }} · {{ actionLabel(workflow) }}
            </p>
            <p class="mt-0.5 text-[12px] text-dimmed">
              {{ workflow.eventTypeTitle ?? 'All event types' }}
            </p>
          </div>
          <div
            v-if="canManage !== false"
            class="flex items-center gap-2 self-end sm:self-auto"
          >
            <USwitch
              :model-value="workflow.active"
              :loading="busyId === workflow.id"
              :aria-label="`${workflow.active ? 'Pause' : 'Resume'} ${workflow.name}`"
              @update:model-value="toggle(workflow, Boolean($event))"
            />
            <UDropdownMenu
              :items="[
                [{ label: 'Edit', icon: 'i-lucide-square-pen', onSelect: () => startEdit(workflow) }],
                [{ label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => { deleting = workflow } }]
              ]"
              :ui="compactActionMenuUi"
            >
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-ellipsis"
                size="xs"
                class="size-7 justify-center p-0"
                :ui="{ leadingIcon: 'size-3.5' }"
                :aria-label="`Actions for ${workflow.name}`"
              />
            </UDropdownMenu>
          </div>
        </li>
      </ul>
      <ListPagination
        :page="data?.pagination.page ?? 1"
        :total-pages="data?.pagination.totalPages ?? 1"
        :total="data?.pagination.total ?? 0"
        :page-size="data?.pagination.pageSize"
        :disabled="refreshing"
        @change="page = $event"
      />
    </section>

    <UModal
      v-model:open="modalOpen"
      :dismissible="false"
      :title="editing ? 'Edit workflow' : 'New workflow'"
      description="Choose one clear trigger and one action. Schedra handles delivery and retries."
      :ui="{ content: 'w-full max-w-2xl', footer: 'border-t border-default px-5 py-4 sm:px-6' }"
    >
      <template #body>
        <form
          id="workflow-form"
          class="space-y-6"
          @submit.prevent="save"
        >
          <UFormField
            label="Workflow name"
            required
          >
            <UInput
              v-model="form.name"
              placeholder="Meeting reminder"
              size="lg"
              autofocus
              class="w-full"
            />
          </UFormField>

          <div class="space-y-4">
            <UFormField
              label="When should it run?"
              required
            >
              <USelectMenu
                v-model="form.trigger"
                :items="triggerOptions"
                value-key="value"
                size="lg"
                class="w-full"
              />
            </UFormField>
            <UFormField
              v-if="['before_start', 'after_end'].includes(form.trigger)"
              :label="form.trigger === 'before_start' ? 'How long before?' : 'How long after?'"
              required
            >
              <USelectMenu
                v-model="form.offsetMinutes"
                :items="form.trigger === 'before_start' ? offsetOptions.filter(option => option.value >= 5) : offsetOptions"
                value-key="value"
                size="lg"
                class="w-full"
              />
            </UFormField>
          </div>

          <UFormField label="Which events?">
            <USelectMenu
              v-model="form.eventTypeId"
              v-model:search-term="eventSearchInput"
              :items="eventTypeOptions"
              :loading="eventTypesStatus === 'pending'"
              :ignore-filter="true"
              value-key="value"
              placeholder="All event types"
              size="lg"
              class="w-full"
            />
            <p class="mt-1.5 text-[13px] text-muted">
              Leave this on all event types to reuse one workflow everywhere.
            </p>
          </UFormField>

          <section class="space-y-4 rounded-xl border border-default bg-muted/40 p-4 sm:p-5">
            <div>
              <h3 class="text-[14px] font-semibold text-highlighted">
                What should Schedra do?
              </h3>
              <p class="mt-1 text-[13px] text-muted">
                Email is best for people. Webhooks securely notify another application.
              </p>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <button
                v-for="option in [
                  { value: 'email', label: 'Send an email', icon: 'i-lucide-mail' },
                  { value: 'webhook', label: 'Send a webhook', icon: 'i-lucide-webhook' }
                ]"
                :key="option.value"
                type="button"
                class="flex min-h-12 items-center gap-2 rounded-lg border px-3 text-left text-[14px] font-medium transition-colors"
                :class="form.action.type === option.value ? 'border-primary bg-primary/10 text-highlighted' : 'border-default bg-default text-muted hover:text-highlighted'"
                :aria-pressed="form.action.type === option.value"
                @click="setActionType(option.value as 'email' | 'webhook')"
              >
                <UIcon
                  :name="option.icon"
                  class="size-4"
                />
                {{ option.label }}
              </button>
            </div>

            <template v-if="form.action.type === 'email'">
              <UFormField
                label="Send to"
                required
              >
                <USelectMenu
                  v-model="form.action.recipient"
                  :items="recipientOptions"
                  value-key="value"
                  size="lg"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                v-if="form.action.recipient === 'custom'"
                label="Recipient email"
                required
              >
                <UInput
                  v-model="form.action.customRecipient"
                  type="email"
                  placeholder="team@company.com"
                  size="lg"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="Subject"
                required
              >
                <UInput
                  v-model="form.action.subject"
                  size="lg"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="Message"
                required
              >
                <UTextarea
                  v-model="form.action.body"
                  :rows="6"
                  autoresize
                  class="w-full"
                />
              </UFormField>
              <p class="text-[12px] leading-relaxed text-dimmed">
                Available details:
                <code
                  v-for="variable in ['guest_name', 'host_name', 'event_name', 'start_time', 'booking_url', 'meeting_url', 'team_name']"
                  :key="variable"
                  class="mr-1"
                >{{ variableToken(variable) }}</code>
              </p>
            </template>
            <template v-else>
              <UFormField
                label="Webhook URL"
                required
                help="Schedra requires HTTPS, signs every request and retries temporary failures."
              >
                <UInput
                  v-model="form.action.url"
                  type="url"
                  placeholder="https://example.com/webhooks/schedra"
                  size="lg"
                  class="w-full"
                />
              </UFormField>
            </template>
          </section>

          <p
            v-if="formError"
            class="rounded-lg border border-error/30 bg-error/5 px-3 py-2.5 text-[13px] text-error"
            role="alert"
          >
            {{ formError }}
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
              form="workflow-form"
              :loading="saving"
            >
              {{ editing ? 'Save changes' : 'Create workflow' }}
            </UButton>
          </template>
        </ModalFooter>
      </template>
    </UModal>

    <ConfirmDialog
      v-model:open="secretOpen"
      title="Save your signing secret"
      description="This secret proves webhook requests came from Schedra. It is shown only once."
    >
      <template #body>
        <div class="flex items-center gap-2 rounded-lg border border-default bg-muted p-2">
          <code class="min-w-0 flex-1 break-all px-2 text-[13px] text-highlighted">{{ secret }}</code>
          <UButton
            color="neutral"
            variant="soft"
            :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
            @click="copySecret"
          >
            {{ copied ? 'Copied' : 'Copy' }}
          </UButton>
        </div>
      </template>
      <template #actions>
        <UButton @click="secretOpen = false">
          I saved it
        </UButton>
      </template>
    </ConfirmDialog>

    <ConfirmDialog
      :open="Boolean(deleting)"
      title="Delete this workflow?"
      description="Scheduled messages that have not run yet will be cancelled."
      confirm-label="Delete workflow"
      confirm-color="error"
      :loading="Boolean(deleting && busyId === deleting.id)"
      @update:open="value => { if (!value) deleting = null }"
      @confirm="remove"
    />
  </div>
</template>
