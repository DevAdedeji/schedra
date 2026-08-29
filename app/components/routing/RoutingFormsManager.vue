<script setup lang="ts">
import { routingFormInputSchema, type RoutingFormInput, type RoutingQuestion } from '#shared/routing'
import {
  apiErrorMessage,
  routingFormsApi,
  type RoutingFormsResponse,
  type RoutingFormSummary
} from '~/services/schedra-api'
import { compactActionMenuUi } from '~/utils/action-menu'

const props = defineProps<{ teamSlug?: string, canManage?: boolean }>()
const feedback = useFeedback()
const { data: currentUser } = await useCurrentUser()
const { host } = useSiteUrl()
const { copy, isCopied } = useCopy()
const { data, refresh, status, error: loadFailure } = await useLazyFetch<RoutingFormsResponse>(
  () => routingFormsApi.listEndpoint(props.teamSlug)
)

const items = computed(() => data.value?.items ?? [])
const eventOptions = computed(() => (data.value?.eventTypes ?? []).map(item => ({ label: item.title, value: item.id })))
const initialLoading = computed(() => status.value === 'pending' && !data.value)
const refreshing = computed(() => status.value === 'pending' && Boolean(data.value))
const modalOpen = ref(false)
const editingId = ref('')
const saving = ref(false)
const loadingForm = ref(false)
const formError = ref('')
const deleting = ref<RoutingFormSummary | null>(null)
const busyId = ref('')

function identifier() {
  return crypto.randomUUID()
}

function blankQuestion(): RoutingQuestion {
  return { id: identifier(), label: '', options: ['', ''], required: true }
}

function emptyForm(): RoutingFormInput {
  return {
    title: '',
    slug: '',
    description: null,
    active: true,
    defaultEventTypeId: data.value?.eventTypes[0]?.id ?? '',
    questions: [blankQuestion()],
    rules: []
  }
}

const form = reactive<RoutingFormInput>(emptyForm())

function resetForm(value = emptyForm()) {
  Object.assign(form, structuredClone(value))
  formError.value = ''
}

function startCreate() {
  editingId.value = ''
  resetForm()
  modalOpen.value = true
}

async function startEdit(item: RoutingFormSummary) {
  editingId.value = item.id
  modalOpen.value = true
  loadingForm.value = true
  formError.value = ''
  try {
    const record = await routingFormsApi.get(item.id, props.teamSlug)
    resetForm(record)
  } catch (failure) {
    formError.value = apiErrorMessage(failure, 'Could not load this routing form.')
  } finally {
    loadingForm.value = false
  }
}

function slugify() {
  if (editingId.value || form.slug) return
  form.slug = form.title.toLocaleLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function addQuestion() {
  if (form.questions.length < 10) form.questions.push(blankQuestion())
}

function removeQuestion(index: number) {
  const question = form.questions[index]
  if (!question || form.questions.length === 1) return
  form.questions.splice(index, 1)
  form.rules = form.rules.filter(rule => rule.conditions.every(condition => condition.questionId !== question.id))
}

function addOption(question: RoutingQuestion) {
  if (question.options.length < 20) question.options.push('')
}

function removeOption(question: RoutingQuestion, index: number) {
  if (question.options.length <= 2) return
  const removed = question.options[index]
  question.options.splice(index, 1)
  form.rules = form.rules.filter(rule => !rule.conditions.some(condition => condition.questionId === question.id && condition.value === removed))
}

function addRoute() {
  const question = form.questions[0]
  const target = data.value?.eventTypes[0]
  if (!question || !target) return
  form.rules.push({
    name: `Route ${form.rules.length + 1}`,
    conditions: [{ questionId: question.id, operator: 'equals', value: question.options.find(Boolean) ?? '' }],
    eventTypeId: target.id
  })
}

function questionOptions(questionId: string) {
  return form.questions.find(question => question.id === questionId)?.options.filter(Boolean) ?? []
}

function changeRuleQuestion(index: number, questionId: string) {
  const condition = form.rules[index]?.conditions[0]
  if (!condition) return
  condition.questionId = questionId
  condition.value = questionOptions(questionId)[0] ?? ''
}

async function save() {
  if (saving.value) return
  const parsed = routingFormInputSchema.safeParse({
    ...form,
    description: form.description?.trim() || null,
    questions: form.questions.map(question => ({
      ...question,
      options: question.options.map(option => option.trim()).filter(Boolean)
    }))
  })
  if (!parsed.success) {
    formError.value = parsed.error.issues[0]?.message ?? 'Check the form details.'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    if (editingId.value) await routingFormsApi.update(editingId.value, parsed.data, props.teamSlug)
    else await routingFormsApi.create(parsed.data, props.teamSlug)
    modalOpen.value = false
    await refresh()
    feedback.success({
      title: editingId.value ? 'Routing form updated' : 'Routing form created',
      description: parsed.data.active ? 'The public link is ready to share.' : 'It is saved as inactive.'
    })
  } catch (failure) {
    formError.value = apiErrorMessage(failure, 'Could not save this routing form.')
  } finally {
    saving.value = false
  }
}

function publicPath(item: { slug: string }) {
  if (props.teamSlug) return `/team/${props.teamSlug}/route/${item.slug}`
  return `/route/${currentUser.value?.user?.username ?? ''}/${item.slug}`
}

async function copyLink(item: RoutingFormSummary) {
  const written = await copy(`${host.value}${publicPath(item)}`, item.id)
  if (written) feedback.success({ title: 'Routing link copied' })
  else feedback.error({ title: 'Could not copy routing link' })
}

function routingActions(item: RoutingFormSummary) {
  const actions: Array<{
    label: string
    icon: string
    onSelect?: () => void | Promise<void>
    to?: string
    target?: string
    color?: 'error'
  }> = [{
    label: isCopied(item.id) ? 'Copied' : 'Copy link',
    icon: isCopied(item.id) ? 'i-lucide-check' : 'i-lucide-copy',
    onSelect: async () => { await copyLink(item) }
  }, {
    label: 'Open public form',
    icon: 'i-lucide-external-link',
    to: publicPath(item),
    target: '_blank'
  }]
  if (props.canManage !== false) {
    actions.push({
      label: 'Edit',
      icon: 'i-lucide-square-pen',
      onSelect: async () => { await startEdit(item) }
    })
    actions.push({
      label: 'Delete',
      icon: 'i-lucide-trash-2',
      color: 'error' as const,
      onSelect: async () => { deleting.value = item }
    })
  }
  return actions.map(action => [action])
}

async function remove() {
  if (!deleting.value) return
  busyId.value = deleting.value.id
  try {
    await routingFormsApi.remove(deleting.value.id, props.teamSlug)
    deleting.value = null
    await refresh()
    feedback.success({ title: 'Routing form deleted' })
  } catch (failure) {
    feedback.error({ title: 'Could not delete routing form', description: apiErrorMessage(failure, 'Turn it off instead if it already has responses.') })
  } finally {
    busyId.value = ''
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="Routing forms"
      description="Ask a few questions, then send each guest to the right booking option."
    >
      <template #actions>
        <UButton
          v-if="canManage !== false"
          icon="i-lucide-plus"
          @click="startCreate"
        >
          New routing form
        </UButton>
      </template>
    </PageHeader>

    <section class="overflow-hidden rounded-xl border border-default bg-default">
      <AsyncErrorState
        v-if="loadFailure && !data"
        title="Could not load routing forms"
        description="Your forms are safe. Check your connection and try again."
        @retry="refresh"
      />
      <ListLoadingSkeleton
        v-else-if="initialLoading"
        label="Loading routing forms"
      />
      <ListEmptyState
        v-else-if="!items.length"
        icon="i-lucide-git-branch"
        title="No routing forms yet"
        description="Qualify visitors with simple questions and guide them to the best event type."
      >
        <template
          v-if="canManage !== false"
          #action
        >
          <UButton
            icon="i-lucide-plus"
            @click="startCreate"
          >
            Create your first routing form
          </UButton>
        </template>
      </ListEmptyState>
      <ul
        v-else
        class="divide-y divide-default"
        :class="refreshing && 'opacity-60'"
      >
        <li
          v-for="item in items"
          :key="item.id"
          class="flex flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:px-5"
        >
          <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <UIcon
              name="i-lucide-git-branch"
              class="size-4"
            />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <p class="truncate text-[14px] font-semibold text-highlighted">
                {{ item.title }}
              </p>
              <UBadge
                :color="item.active ? 'success' : 'neutral'"
                variant="subtle"
                size="sm"
              >
                {{ item.active ? 'Live' : 'Inactive' }}
              </UBadge>
            </div>
            <p class="mt-1 truncate text-[12px] text-muted">
              {{ publicPath(item) }}
            </p>
            <p class="mt-1 text-[11px] text-dimmed">
              {{ item.questions.length }} {{ item.questions.length === 1 ? 'question' : 'questions' }} ·
              {{ item.responseCount }} {{ item.responseCount === 1 ? 'response' : 'responses' }} ·
              fallback to {{ item.defaultEventTitle }}
            </p>
          </div>
          <div class="flex items-center gap-2 self-end sm:self-auto">
            <UDropdownMenu
              :items="routingActions(item)"
              :ui="compactActionMenuUi"
            >
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-ellipsis"
                class="size-7 justify-center p-0"
                :ui="{ leadingIcon: 'size-3.5' }"
                :aria-label="`Actions for ${item.title}`"
              />
            </UDropdownMenu>
          </div>
        </li>
      </ul>
    </section>

    <UModal
      v-model:open="modalOpen"
      :dismissible="false"
      :title="editingId ? 'Edit routing form' : 'New routing form'"
      description="Ask only what you need. The first matching route wins; everyone else uses your fallback."
      :ui="{ content: 'w-full max-w-3xl', footer: 'border-t border-default px-5 py-4 sm:px-6' }"
    >
      <template #body>
        <ListLoadingSkeleton
          v-if="loadingForm"
          label="Loading routing form"
        />
        <form
          v-else
          id="routing-form"
          class="space-y-7"
          @submit.prevent="save"
        >
          <section class="grid gap-4 sm:grid-cols-2">
            <UFormField
              label="Form title"
              required
            >
              <UInput
                v-model="form.title"
                placeholder="Find the right meeting"
                size="lg"
                class="w-full"
                autofocus
                @blur="slugify"
              />
            </UFormField>
            <UFormField
              label="Public link"
              required
            >
              <UInput
                v-model="form.slug"
                placeholder="find-a-time"
                size="lg"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Short introduction"
              class="sm:col-span-2"
            >
              <UTextarea
                :model-value="form.description ?? ''"
                placeholder="Tell us what you need and we’ll guide you."
                :rows="2"
                class="w-full"
                @update:model-value="form.description = String($event)"
              />
            </UFormField>
          </section>

          <section class="space-y-4">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h3 class="text-[14px] font-semibold text-highlighted">
                  Questions
                </h3>
                <p class="mt-1 text-[12px] text-muted">
                  Multiple-choice answers keep routing fast and predictable.
                </p>
              </div>
              <UButton
                color="neutral"
                variant="soft"
                icon="i-lucide-plus"
                :disabled="form.questions.length >= 10"
                @click="addQuestion"
              >
                Add question
              </UButton>
            </div>
            <article
              v-for="(question, questionIndex) in form.questions"
              :key="question.id"
              class="space-y-4 rounded-xl border border-default bg-muted/30 p-4"
            >
              <div class="flex items-center gap-3">
                <span class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-[11px] font-semibold text-primary">{{ questionIndex + 1 }}</span>
                <UInput
                  v-model="question.label"
                  placeholder="What would you like to discuss?"
                  size="lg"
                  class="flex-1"
                />
                <UButton
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  class="size-9 justify-center p-0"
                  :disabled="form.questions.length === 1"
                  :aria-label="`Remove question ${questionIndex + 1}`"
                  @click="removeQuestion(questionIndex)"
                />
              </div>
              <div class="grid gap-2 sm:grid-cols-2">
                <div
                  v-for="(_, optionIndex) in question.options"
                  :key="optionIndex"
                  class="flex items-center gap-1.5"
                >
                  <UInput
                    v-model="question.options[optionIndex]"
                    :placeholder="`Choice ${optionIndex + 1}`"
                    class="flex-1"
                  />
                  <UButton
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-x"
                    class="size-8 justify-center p-0"
                    :disabled="question.options.length <= 2"
                    :aria-label="`Remove choice ${optionIndex + 1}`"
                    @click="removeOption(question, optionIndex)"
                  />
                </div>
              </div>
              <UButton
                color="neutral"
                variant="link"
                icon="i-lucide-plus"
                class="p-0"
                :disabled="question.options.length >= 20"
                @click="addOption(question)"
              >
                Add choice
              </UButton>
            </article>
          </section>

          <section class="space-y-4">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h3 class="text-[14px] font-semibold text-highlighted">
                  Routes
                </h3>
                <p class="mt-1 text-[12px] text-muted">
                  Send a specific answer to a specific event type.
                </p>
              </div>
              <UButton
                color="neutral"
                variant="soft"
                icon="i-lucide-plus"
                :disabled="form.rules.length >= 20"
                @click="addRoute"
              >
                Add route
              </UButton>
            </div>
            <p
              v-if="!form.rules.length"
              class="rounded-xl border border-dashed border-default px-4 py-5 text-center text-[12px] text-muted"
            >
              No special routes yet. Every answer will use the fallback below.
            </p>
            <article
              v-for="(rule, ruleIndex) in form.rules"
              :key="ruleIndex"
              class="grid gap-3 rounded-xl border border-default bg-muted/30 p-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
            >
              <UFormField label="Route name">
                <UInput
                  v-model="rule.name"
                  placeholder="Sales call"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="When answer to">
                <USelectMenu
                  :model-value="rule.conditions[0]?.questionId"
                  :items="form.questions.map(q => ({ label: q.label || 'Untitled question', value: q.id }))"
                  value-key="value"
                  class="w-full"
                  @update:model-value="changeRuleQuestion(ruleIndex, String($event))"
                />
              </UFormField>
              <UFormField label="Is">
                <USelectMenu
                  v-model="rule.conditions[0]!.value"
                  :items="questionOptions(rule.conditions[0]!.questionId)"
                  class="w-full"
                />
              </UFormField>
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-trash-2"
                class="mb-0.5 size-9 justify-center p-0"
                :aria-label="`Remove route ${ruleIndex + 1}`"
                @click="form.rules.splice(ruleIndex, 1)"
              />
              <UFormField
                label="Send them to"
                class="sm:col-span-4"
              >
                <USelectMenu
                  v-model="rule.eventTypeId"
                  :items="eventOptions"
                  value-key="value"
                  class="w-full"
                />
              </UFormField>
            </article>
          </section>

          <section class="grid gap-4 rounded-xl border border-default bg-muted/30 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <UFormField
              label="Fallback event type"
              required
              help="Guests who do not match a route are sent here."
            >
              <USelectMenu
                v-model="form.defaultEventTypeId"
                :items="eventOptions"
                value-key="value"
                size="lg"
                class="w-full"
              />
            </UFormField>
            <UCheckbox
              v-model="form.active"
              label="Public link is active"
              class="sm:mt-7"
            />
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
              form="routing-form"
              :loading="saving"
              :disabled="loadingForm"
            >
              {{ editingId ? 'Save changes' : 'Create routing form' }}
            </UButton>
          </template>
        </ModalFooter>
      </template>
    </UModal>

    <ConfirmDialog
      :open="Boolean(deleting)"
      title="Delete this routing form?"
      description="Its public link will stop working. Forms with response history can be made inactive instead."
      confirm-label="Delete form"
      confirm-color="error"
      :loading="Boolean(deleting && busyId === deleting.id)"
      @update:open="value => { if (!value) deleting = null }"
      @confirm="remove"
    />
  </div>
</template>
