import { reactive, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { workflowInputSchema, type WorkflowInput, type WorkflowTrigger } from '#shared/workflows'
import { apiErrorMessage, workflowsApi, type WorkflowRecord } from '~/services/schedra-api'
import { WORKFLOW_OFFSET_OPTIONS, WORKFLOW_TRIGGER_OPTIONS } from '~/constants/workflows'

function emptyWorkflowForm(): WorkflowInput {
  return {
    name: '', trigger: 'booking_created', offsetMinutes: 0, eventTypeId: null,
    action: {
      type: 'email', recipient: 'attendee', subject: 'About {{event_name}}',
      body: 'Hi {{guest_name}},\n\nYour meeting with {{host_name}} is scheduled for {{start_time}}.',
      customRecipient: undefined
    },
    active: true
  }
}

export function useWorkflowManager(options: {
  teamSlug: MaybeRefOrGetter<string | undefined>
  refresh: () => Promise<unknown>
}) {
  const feedback = useFeedback()
  const { copied, copy } = useCopy()
  const modalOpen = ref(false)
  const editing = ref<WorkflowRecord | null>(null)
  const form = reactive<WorkflowInput>(emptyWorkflowForm())
  const saving = ref(false)
  const formError = ref('')
  const secret = ref('')
  const secretOpen = ref(false)
  const busyId = ref('')
  const deleting = ref<WorkflowRecord | null>(null)

  function startCreate() {
    editing.value = null
    Object.assign(form, emptyWorkflowForm())
    formError.value = ''
    modalOpen.value = true
  }

  function startEdit(workflow: WorkflowRecord) {
    editing.value = workflow
    Object.assign(form, {
      name: workflow.name, trigger: workflow.trigger, offsetMinutes: workflow.offsetMinutes,
      eventTypeId: workflow.eventTypeId, action: structuredClone(workflow.action), active: workflow.active
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
      const teamSlug = toValue(options.teamSlug)
      const result = editing.value
        ? await workflowsApi.update(editing.value.id, parsed.data, teamSlug)
        : await workflowsApi.create(parsed.data, teamSlug)
      modalOpen.value = false
      await options.refresh()
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

  async function toggle(workflow: WorkflowRecord, active: boolean) {
    busyId.value = workflow.id
    try {
      await workflowsApi.setActive(workflow.id, active, toValue(options.teamSlug))
      await options.refresh()
      feedback.success({ title: active ? 'Workflow resumed' : 'Workflow paused' })
    } catch (failure) {
      feedback.error({ title: 'Could not update workflow', description: apiErrorMessage(failure, 'Please try again.') })
    } finally {
      busyId.value = ''
    }
  }

  async function remove() {
    if (!deleting.value) return
    busyId.value = deleting.value.id
    try {
      await workflowsApi.remove(deleting.value.id, toValue(options.teamSlug))
      deleting.value = null
      await options.refresh()
      feedback.success({ title: 'Workflow deleted' })
    } catch (failure) {
      feedback.error({ title: 'Could not delete workflow', description: apiErrorMessage(failure, 'Please try again.') })
    } finally {
      busyId.value = ''
    }
  }

  function triggerLabel(trigger: WorkflowTrigger) {
    return WORKFLOW_TRIGGER_OPTIONS.find(option => option.value === trigger)?.label ?? trigger
  }

  function timing(workflow: WorkflowRecord) {
    if (!['before_start', 'after_end'].includes(workflow.trigger)) return 'Immediately'
    const offset = WORKFLOW_OFFSET_OPTIONS.find(option => option.value === workflow.offsetMinutes)?.label ?? `${workflow.offsetMinutes} minutes`
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

  return {
    modalOpen, editing, form, saving, formError, secret, secretOpen, copied, busyId,
    deleting, startCreate, startEdit, setActionType, save, toggle, remove,
    triggerLabel, timing, actionLabel, variableToken, copySecret
  }
}
