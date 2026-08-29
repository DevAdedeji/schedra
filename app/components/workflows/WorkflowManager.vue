<script setup lang="ts">
import { workflowInputSchema, type WorkflowInput, type WorkflowTrigger } from '#shared/workflows'
import {
  apiErrorMessage,
  workflowsApi,
  type EventTypesResponse,
  type TeamEventTypesResponse,
  type WorkflowRecord,
  type WorkflowsResponse
} from '~/services/schedra-api'
import { compactActionMenuUi } from '~/utils/action-menu'

const props = defineProps<{
  teamSlug?: string
  eventTypesEndpoint: string
  canManage: boolean
}>()

const feedback = useFeedback()
const { copied, copy } = useCopy()
const page = ref(1)
const { data, refresh, status, error: loadFailure } = await useLazyFetch<WorkflowsResponse>(
  () => workflowsApi.listEndpoint(props.teamSlug),
  { query: computed(() => ({ page: page.value, pageSize: 10 })) }
)

const list = computed(() => data.value?.items ?? [])
const initialLoading = computed(() => status.value === 'pending' && !data.value)
const refreshing = computed(() => status.value === 'pending' && Boolean(data.value))

const triggerOptions: Array<{ label: string, value: WorkflowTrigger, description: string }> = [
  { label: 'A booking is confirmed', value: 'booking_created', description: 'Runs immediately after a guest books.' },
  { label: 'A booking needs approval', value: 'booking_requested', description: 'Runs when a guest submits a request.' },
  { label: 'A request is approved', value: 'booking_approved', description: 'Runs after the host confirms it.' },
  { label: 'A request is declined', value: 'booking_rejected', description: 'Runs after the host declines it.' },
  { label: 'A booking is cancelled', value: 'booking_cancelled', description: 'Runs for guest or host cancellations.' },
  { label: 'A booking is rescheduled', value: 'booking_rescheduled', description: 'Runs after a guest chooses a new time.' },
  { label: 'Before a meeting starts', value: 'before_start', description: 'Useful for reminders and preparation.' },
  { label: 'After a meeting ends', value: 'after_end', description: 'Useful for follow-ups and feedback.' }
]

const offsetOptions = [
  { label: 'Immediately', value: 0 },
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '1 hour', value: 60 },
  { label: '2 hours', value: 120 },
  { label: '1 day', value: 1440 },
  { label: '2 days', value: 2880 },
  { label: '1 week', value: 10080 }
]

const recipientOptions = [
  { label: 'The attendee', value: 'attendee' },
  { label: 'The host or assigned hosts', value: 'hosts' },
  { label: 'A specific email address', value: 'custom' }
]

function emptyForm(): WorkflowInput {
  return {
    name: '',
    trigger: 'booking_created',
    offsetMinutes: 0,
    eventTypeId: null,
    action: {
      type: 'email',
      recipient: 'attendee',
      subject: 'About {{event_name}}',
      body: 'Hi {{guest_name}},\n\nYour meeting with {{host_name}} is scheduled for {{start_time}}.',
      customRecipient: undefined
    },
    active: true
  }
}

const modalOpen = ref(false)
const editing = ref<WorkflowRecord | null>(null)
const form = reactive<WorkflowInput>(emptyForm())
const saving = ref(false)
const formError = ref('')
const eventSearchInput = ref('')
const eventSearch = ref('')
let eventSearchTimer: ReturnType<typeof setTimeout> | undefined

watch(eventSearchInput, (value) => {
  clearTimeout(eventSearchTimer)
  eventSearchTimer = setTimeout(() => {
    eventSearch.value = value.trim()
  }, 250)
})
onBeforeUnmount(() => clearTimeout(eventSearchTimer))

const { data: eventTypes, status: eventTypesStatus, refresh: refreshEventTypes } = await useLazyFetch<EventTypesResponse | TeamEventTypesResponse>(
  () => props.eventTypesEndpoint,
  { query: computed(() => ({ page: 1, pageSize: 10, search: eventSearch.value })), immediate: false }
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
  eventSearchInput.value = ''
  eventSearch.value = ''
  await refreshEventTypes()
})

function startCreate() {
  editing.value = null
  Object.assign(form, emptyForm())
  formError.value = ''
  modalOpen.value = true
}

function startEdit(workflow: WorkflowRecord) {
  editing.value = workflow
  Object.assign(form, {
    name: workflow.name,
    trigger: workflow.trigger,
    offsetMinutes: workflow.offsetMinutes,
    eventTypeId: workflow.eventTypeId,
    action: structuredClone(workflow.action),
    active: workflow.active
  })
  formError.value = ''
  modalOpen.value = true
}

watch(() => form.trigger, (trigger) => {
  if (trigger === 'before_start' && form.offsetMinutes < 5) form.offsetMinutes = 60
  if (trigger === 'after_end' && form.offsetMinutes < 0) form.offsetMinutes = 0
  if (!['before_start', 'after_end'].includes(trigger)) form.offsetMinutes = 0
})

function setActionType(type: 'email' | 'webhook') {
  form.action = type === 'email'
    ? {
        type: 'email', recipient: 'attendee', customRecipient: undefined,
        subject: 'About {{event_name}}',
        body: 'Hi {{guest_name}},\n\nYour meeting with {{host_name}} is scheduled for {{start_time}}.'
      }
    : { type: 'webhook', url: '' }
}

const secret = ref('')
const secretOpen = ref(false)

async function save() {
  if (saving.value) return
  const parsed = workflowInputSchema.safeParse(form)
  if (!parsed.success) {
    formError.value = parsed.error.issues[0]?.message ?? 'Check the workflow details.'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    const result = editing.value
      ? await workflowsApi.update(editing.value.id, parsed.data, props.teamSlug)
      : await workflowsApi.create(parsed.data, props.teamSlug)
    modalOpen.value = false
    await refresh()
    feedback.success({
      title: editing.value ? 'Workflow updated' : 'Workflow created',
      description: parsed.data.active ? 'It is active now.' : 'It is saved as paused.'
    })
    if (result.webhookSecret) {
      secret.value = result.webhookSecret
      secretOpen.value = true
    }
  } catch (failure) {
    formError.value = apiErrorMessage(failure, 'Could not save this workflow.')
  } finally {
    saving.value = false
  }
}

const busyId = ref('')
async function toggle(workflow: WorkflowRecord, active: boolean) {
  busyId.value = workflow.id
  try {
    await workflowsApi.setActive(workflow.id, active, props.teamSlug)
    await refresh()
    feedback.success({ title: active ? 'Workflow resumed' : 'Workflow paused' })
  } catch (failure) {
    feedback.error({ title: 'Could not update workflow', description: apiErrorMessage(failure, 'Please try again.') })
  } finally {
    busyId.value = ''
  }
}

const deleting = ref<WorkflowRecord | null>(null)
async function remove() {
  if (!deleting.value) return
  busyId.value = deleting.value.id
  try {
    await workflowsApi.remove(deleting.value.id, props.teamSlug)
    deleting.value = null
    await refresh()
    feedback.success({ title: 'Workflow deleted' })
  } catch (failure) {
    feedback.error({ title: 'Could not delete workflow', description: apiErrorMessage(failure, 'Please try again.') })
  } finally {
    busyId.value = ''
  }
}

function triggerLabel(trigger: WorkflowTrigger) {
  return triggerOptions.find(option => option.value === trigger)?.label ?? trigger
}

function timing(workflow: WorkflowRecord) {
  if (!['before_start', 'after_end'].includes(workflow.trigger)) return 'Immediately'
  const offset = offsetOptions.find(option => option.value === workflow.offsetMinutes)?.label ?? `${workflow.offsetMinutes} minutes`
  return workflow.trigger === 'before_start' ? `${offset} before` : `${offset} after`
}

function actionLabel(workflow: WorkflowRecord) {
  if (workflow.action.type === 'webhook') return `Webhook · ${new URL(workflow.action.url).hostname}`
  return workflow.action.recipient === 'attendee'
    ? 'Email attendee'
    : workflow.action.recipient === 'hosts'
      ? 'Email hosts'
      : `Email ${workflow.action.customRecipient}`
}

function variableToken(variable: string) {
  return `{{${variable}}}`
}

async function copySecret() {
  const written = await copy(secret.value)
  if (written) feedback.success({ title: 'Signing secret copied' })
  else feedback.error({ title: 'Could not copy signing secret' })
}
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
              <p class="truncate text-[14px] font-semibold text-highlighted">
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
            <p class="mt-1 text-[12px] leading-relaxed text-muted">
              {{ triggerLabel(workflow.trigger) }} · {{ timing(workflow) }} · {{ actionLabel(workflow) }}
            </p>
            <p class="mt-0.5 text-[11px] text-dimmed">
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
            <p class="mt-1.5 text-[12px] text-muted">
              Leave this on all event types to reuse one workflow everywhere.
            </p>
          </UFormField>

          <section class="space-y-4 rounded-xl border border-default bg-muted/40 p-4 sm:p-5">
            <div>
              <h3 class="text-[13px] font-semibold text-highlighted">
                What should Schedra do?
              </h3>
              <p class="mt-1 text-[12px] text-muted">
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
                class="flex min-h-12 items-center gap-2 rounded-lg border px-3 text-left text-[13px] font-medium transition-colors"
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
              <p class="text-[11px] leading-relaxed text-dimmed">
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
            class="rounded-lg border border-error/30 bg-error/5 px-3 py-2.5 text-[12px] text-error"
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
          <code class="min-w-0 flex-1 break-all px-2 text-[12px] text-highlighted">{{ secret }}</code>
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
