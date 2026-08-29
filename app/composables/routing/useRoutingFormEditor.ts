import { reactive, ref, toValue, type MaybeRefOrGetter } from 'vue'
import { routingFormInputSchema, type RoutingFormInput, type RoutingQuestion } from '#shared/routing'
import { apiErrorMessage, routingFormsApi, type RoutingFormsResponse, type RoutingFormSummary } from '~/services/schedra-api'

function identifier() {
  return crypto.randomUUID()
}

function blankQuestion(): RoutingQuestion {
  return { id: identifier(), label: '', options: ['', ''], required: true }
}

export function useRoutingFormEditor(options: {
  teamSlug: MaybeRefOrGetter<string | undefined>
  eventTypes: MaybeRefOrGetter<RoutingFormsResponse['eventTypes'] | undefined>
  refresh: () => Promise<unknown>
}) {
  const feedback = useFeedback()
  const modalOpen = ref(false)
  const editingId = ref('')
  const saving = ref(false)
  const loadingForm = ref(false)
  const formError = ref('')

  function emptyForm(): RoutingFormInput {
    return {
      title: '', slug: '', description: null, active: true,
      defaultEventTypeId: toValue(options.eventTypes)?.[0]?.id ?? '',
      questions: [blankQuestion()], rules: []
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
      resetForm(await routingFormsApi.get(item.id, toValue(options.teamSlug)))
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
    const target = toValue(options.eventTypes)?.[0]
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
      const teamSlug = toValue(options.teamSlug)
      if (editingId.value) await routingFormsApi.update(editingId.value, parsed.data, teamSlug)
      else await routingFormsApi.create(parsed.data, teamSlug)
      modalOpen.value = false
      await options.refresh()
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

  return {
    modalOpen, editingId, saving, loadingForm, formError, form, resetForm,
    startCreate, startEdit, slugify, addQuestion, removeQuestion, addOption,
    removeOption, addRoute, questionOptions, changeRuleQuestion, save
  }
}
