<script setup lang="ts">
import {
  eventTypeSchema,
  type BookingQuestion,
  type BookingQuestionType,
  type EventTypeInput
} from '#shared/validation'
import { apiErrorMessage, calendarApi, eventTypesApi, schedulesApi, type CalendarConnection, type SchedulesResponse } from '~/services/schedra-api'
import type { EventTypeRecord } from '~/types/event-type'

const props = defineProps<{ open: boolean, eventType?: EventTypeRecord | null }>()
const emit = defineEmits<{ 'update:open': [value: boolean], 'saved': [action: 'created' | 'updated'] }>()
type EventTypeForm = Omit<EventTypeInput, 'bookingWindowDays' | 'maxPerDay'> & {
  bookingWindowDays?: number
  maxPerDay?: number
}

const currentUserRequest = useCurrentUser()
const schedulesRequest = useFetch<SchedulesResponse>(schedulesApi.listEndpoint, {
  query: { pageSize: 10 },
  immediate: false
})
const calendarConnectionRequest = useFetch<CalendarConnection>(calendarApi.connectionEndpoint, {
  immediate: false
})
const [
  { data: currentUser },
  { data: schedules, refresh: refreshSchedules },
  { data: calendarConnection, refresh: refreshCalendarConnection }
] = await Promise.all([currentUserRequest, schedulesRequest, calendarConnectionRequest])
const { host } = useSiteUrl()
const form = reactive<EventTypeForm>(emptyForm())
const initial = ref('')
const slugTouched = ref(false)
const saving = ref(false)
const error = ref('')

const isOpen = computed({ get: () => props.open, set: value => emit('update:open', value) })
const username = computed(() => currentUser.value?.user?.username ?? '')
const initials = computed(() => (currentUser.value?.user?.name ?? 'S')
  .split(' ').map(part => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase())
const bookingUrl = computed(() => `${host.value}/${username.value}/${form.slug || 'your-link'}`)
const scheduleOptions = computed(() => (schedules.value?.items ?? []).map(schedule => ({
  label: schedule.isDefault ? `${schedule.name} (default)` : schedule.name,
  value: schedule.id
})))
const selectedSchedule = computed(() => schedules.value?.items.find(schedule => schedule.id === form.scheduleId))
const valid = computed(() => eventTypeSchema.safeParse(form).success && Boolean(form.scheduleId))
const dirty = computed(() => JSON.stringify(form) !== initial.value)
const googleMeetReady = computed(() => Boolean(calendarConnection.value?.connected && calendarConnection.value.writeCalendarId))
const locationOptions = computed(() => [
  { label: 'Google Meet', value: 'google_meet', icon: 'i-simple-icons-googlemeet', disabled: !googleMeetReady.value },
  { label: 'Video link', value: 'video_link', icon: 'i-lucide-video' },
  { label: 'Phone call', value: 'phone', icon: 'i-lucide-phone' },
  { label: 'In person', value: 'in_person', icon: 'i-lucide-map-pin' },
  { label: 'Custom instructions', value: 'custom', icon: 'i-lucide-message-square-text' }
])
const questionTypeOptions = [
  { label: 'Short answer', value: 'short_text' },
  { label: 'Long answer', value: 'long_text' },
  { label: 'Choose one', value: 'select' }
]
const locationField = computed(() => ({
  video_link: { label: 'Meeting link', help: 'Guests receive this link after booking.', placeholder: 'https://zoom.us/j/…' },
  phone: { label: 'Call instructions', help: 'Explain who calls whom and which number to use.', placeholder: 'I will call you on the number we have on file.' },
  in_person: { label: 'Address', help: 'Include enough detail for guests to find you.', placeholder: '12 Marina Road, Lagos · Reception, 2nd floor' },
  custom: { label: 'Meeting instructions', help: 'Tell guests exactly how or where you will meet.', placeholder: 'I will share the meeting details before the call.' }
}[form.locationType === 'google_meet' ? 'custom' : form.locationType]))

const previewDays = [
  { day: 'MON', date: '24', active: true },
  { day: 'TUE', date: '25', active: false },
  { day: 'WED', date: '26', active: false },
  { day: 'THU', date: '27', active: false },
  { day: 'FRI', date: '28', active: false }
]

function emptyForm(): EventTypeForm {
  return {
    title: '', slug: '', description: '', durationMinutes: 30, incrementMinutes: null,
    bufferBeforeMinutes: 0, bufferAfterMinutes: 0, minimumNoticeMinutes: 120,
    bookingWindowDays: 60, maxPerDay: undefined,
    locationType: 'custom', locationDetails: 'The host will share meeting details before the meeting.',
    reminderMinutes: [1440, 60],
    bookingQuestions: [],
    scheduleId: schedules.value?.items.find(schedule => schedule.isDefault)?.id ?? schedules.value?.items[0]?.id,
    hidden: false
  }
}

function loadForm() {
  const item = props.eventType
  Object.assign(form, item
    ? {
        title: item.title,
        slug: item.slug,
        description: item.description ?? '',
        durationMinutes: item.durationMinutes,
        incrementMinutes: item.incrementMinutes,
        bufferBeforeMinutes: item.bufferBeforeMinutes,
        bufferAfterMinutes: item.bufferAfterMinutes,
        minimumNoticeMinutes: item.minimumNoticeMinutes,
        bookingWindowDays: item.bookingWindowDays ?? undefined,
        maxPerDay: item.maxPerDay ?? undefined,
        locationType: item.locationType,
        locationDetails: item.locationDetails,
        reminderMinutes: [...item.reminderMinutes],
        bookingQuestions: item.bookingQuestions.map(question => ({
          ...question,
          options: [...question.options]
        })),
        scheduleId: item.scheduleId ?? schedules.value?.items.find(schedule => schedule.isDefault)?.id ?? schedules.value?.items[0]?.id,
        hidden: item.hidden
      }
    : emptyForm())
  initial.value = JSON.stringify(form)
  slugTouched.value = Boolean(item)
  error.value = ''
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 64)
}

function reminderEnabled(minutes: number) {
  return form.reminderMinutes.includes(minutes)
}

function toggleReminder(minutes: number, enabled: boolean) {
  form.reminderMinutes = enabled
    ? [...new Set([...form.reminderMinutes, minutes])].sort((a, b) => b - a)
    : form.reminderMinutes.filter(value => value !== minutes)
}

function addQuestion() {
  if (form.bookingQuestions.length >= 10) return
  form.bookingQuestions.push({
    id: crypto.randomUUID(),
    label: '',
    type: 'short_text',
    required: false,
    options: []
  })
}

function removeQuestion(index: number) {
  form.bookingQuestions.splice(index, 1)
}

function moveQuestion(index: number, direction: -1 | 1) {
  const target = index + direction
  if (target < 0 || target >= form.bookingQuestions.length) return
  const [question] = form.bookingQuestions.splice(index, 1)
  if (question) form.bookingQuestions.splice(target, 0, question)
}

function changeQuestionType(question: BookingQuestion, value: unknown) {
  const type = value as BookingQuestionType
  question.type = type
  question.options = type === 'select'
    ? question.options.length >= 2 ? question.options : ['Option 1', 'Option 2']
    : []
}

function addQuestionOption(question: BookingQuestion) {
  if (question.options.length >= 20) return
  question.options.push(`Option ${question.options.length + 1}`)
}

function removeQuestionOption(question: BookingQuestion, index: number) {
  if (question.options.length <= 2) return
  question.options.splice(index, 1)
}

watch(() => props.open, (open) => {
  if (open) {
    Promise.allSettled([refreshSchedules(), refreshCalendarConnection()]).then(loadForm)
  }
})
watch(() => props.eventType, () => {
  if (props.open) loadForm()
})
watch(() => form.title, (title) => {
  if (!slugTouched.value && !props.eventType) form.slug = slugify(title)
})

async function save() {
  const parsed = eventTypeSchema.safeParse(form)
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message ?? 'Check the event settings and try again.'
    return
  }
  saving.value = true
  error.value = ''
  try {
    if (props.eventType) await eventTypesApi.update(props.eventType.id, parsed.data)
    else await eventTypesApi.create(parsed.data)
    await refreshNuxtData('/api/event-types')
    emit('saved', props.eventType ? 'updated' : 'created')
    isOpen.value = false
  } catch (failure) {
    error.value = apiErrorMessage(failure, 'Could not save this event type just now.')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :title="eventType ? 'Edit event type' : 'New event type'"
    :description="eventType ? 'Update how this meeting works for future bookings.' : 'Create a polished booking experience for your guests.'"
    scrollable
    :ui="{
      content: 'h-[calc(100dvh-2rem)] w-full max-w-none sm:h-[min(92dvh,56rem)] sm:max-w-6xl',
      header: 'border-b border-default px-5 py-4 sm:px-6 sm:py-5',
      body: 'min-h-0 flex-1 overflow-y-auto p-0 sm:p-0',
      footer: 'border-t border-default px-5 py-4 sm:px-6'
    }"
  >
    <template #body>
      <form
        id="event-type-form"
        class="grid min-h-0 lg:grid-cols-[minmax(0,1fr)_22rem]"
        @submit.prevent="save"
      >
        <div class="space-y-5 px-5 py-5 sm:px-6 sm:py-6">
          <section class="overflow-hidden rounded-xl border border-default bg-default">
            <div class="flex gap-3 border-b border-default px-5 py-4">
              <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><UIcon
                name="i-lucide-sparkles"
                class="size-4"
              /></span>
              <div>
                <h3 class="text-[14px] font-semibold text-highlighted">
                  Event details
                </h3>
                <p class="mt-0.5 text-[12px] text-muted">
                  What guests see when they open your link.
                </p>
              </div>
            </div>
            <div class="space-y-5 px-5 py-5">
              <UFormField
                label="Event name"
                name="title"
                required
              >
                <UInput
                  v-model="form.title"
                  size="lg"
                  :maxlength="100"
                  placeholder="30 minute introduction"
                  autocomplete="off"
                  class="w-full"
                  autofocus
                />
              </UFormField>
              <UFormField
                label="Description"
                name="description"
                hint="Optional"
              >
                <UTextarea
                  v-model="form.description"
                  :rows="3"
                  :maxlength="1000"
                  placeholder="Share what the meeting is for and anything guests should prepare."
                  class="w-full"
                />
              </UFormField>
              <div class="grid gap-5 sm:grid-cols-2">
                <UFormField
                  label="Duration"
                  name="durationMinutes"
                  required
                >
                  <UInput
                    v-model.number="form.durationMinutes"
                    type="number"
                    min="5"
                    max="720"
                    step="5"
                    size="lg"
                    class="w-full"
                  >
                    <template #trailing>
                      <span class="text-xs text-dimmed">minutes</span>
                    </template>
                  </UInput>
                </UFormField>
                <UFormField
                  label="Booking URL"
                  name="slug"
                  required
                >
                  <UsernameField
                    v-model="form.slug"
                    :prefix="`/${username}/`"
                    size="lg"
                    placeholder="event-name"
                    :maxlength="64"
                    @input="slugTouched = true; form.slug = slugify(form.slug)"
                  />
                </UFormField>
              </div>
            </div>
          </section>

          <section class="overflow-hidden rounded-xl border border-default bg-default">
            <div class="flex flex-col gap-4 border-b border-default px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
              <div class="flex min-w-0 gap-3">
                <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><UIcon
                  name="i-lucide-list-checks"
                  class="size-4"
                /></span>
                <div>
                  <h3 class="text-[14px] font-semibold text-highlighted">
                    Guest questions
                  </h3>
                  <p class="mt-0.5 text-[12px] leading-relaxed text-muted">
                    Collect the context you need before the meeting. Name and email are always requested.
                  </p>
                </div>
              </div>
              <UButton
                color="neutral"
                variant="outline"
                size="sm"
                icon="i-lucide-plus"
                class="w-full shrink-0 justify-center sm:w-auto"
                :disabled="form.bookingQuestions.length >= 10"
                @click="addQuestion"
              >
                Add question
              </UButton>
            </div>

            <div
              v-if="form.bookingQuestions.length"
              class="space-y-3 px-5 py-5"
            >
              <div
                v-for="(question, questionIndex) in form.bookingQuestions"
                :key="question.id"
                class="rounded-xl border border-default bg-muted p-4"
              >
                <div class="flex items-center justify-between gap-3">
                  <p class="text-[12px] font-semibold text-muted">
                    Question {{ questionIndex + 1 }}
                  </p>
                  <div class="flex items-center gap-0.5">
                    <UButton
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      icon="i-lucide-arrow-up"
                      class="size-7 justify-center p-0"
                      :disabled="questionIndex === 0"
                      :aria-label="`Move question ${questionIndex + 1} up`"
                      @click="moveQuestion(questionIndex, -1)"
                    />
                    <UButton
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      icon="i-lucide-arrow-down"
                      class="size-7 justify-center p-0"
                      :disabled="questionIndex === form.bookingQuestions.length - 1"
                      :aria-label="`Move question ${questionIndex + 1} down`"
                      @click="moveQuestion(questionIndex, 1)"
                    />
                    <UButton
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      icon="i-lucide-trash-2"
                      class="size-7 justify-center p-0 hover:text-error"
                      :aria-label="`Delete question ${questionIndex + 1}`"
                      @click="removeQuestion(questionIndex)"
                    />
                  </div>
                </div>

                <div class="mt-3 grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
                  <UFormField
                    label="Question"
                    :name="`bookingQuestions.${questionIndex}.label`"
                    required
                  >
                    <UInput
                      v-model="question.label"
                      :maxlength="120"
                      placeholder="What would you like to discuss?"
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField
                    label="Answer type"
                    :name="`bookingQuestions.${questionIndex}.type`"
                  >
                    <USelectMenu
                      :model-value="question.type"
                      :items="questionTypeOptions"
                      value-key="value"
                      label-key="label"
                      class="w-full"
                      @update:model-value="changeQuestionType(question, $event)"
                    />
                  </UFormField>
                </div>

                <div
                  v-if="question.type === 'select'"
                  class="mt-4 rounded-lg border border-default bg-default p-3"
                >
                  <div class="flex items-center justify-between gap-3">
                    <p class="text-[12px] font-medium text-toned">
                      Choices
                    </p>
                    <UButton
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      icon="i-lucide-plus"
                      :disabled="question.options.length >= 20"
                      @click="addQuestionOption(question)"
                    >
                      Add choice
                    </UButton>
                  </div>
                  <div class="mt-2 space-y-2">
                    <div
                      v-for="(_option, optionIndex) in question.options"
                      :key="optionIndex"
                      class="flex items-center gap-2"
                    >
                      <span class="size-2 shrink-0 rounded-full border border-default" />
                      <UInput
                        v-model="question.options[optionIndex]"
                        :maxlength="80"
                        :aria-label="`Choice ${optionIndex + 1}`"
                        class="min-w-0 flex-1"
                      />
                      <UButton
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        icon="i-lucide-x"
                        class="size-7 justify-center p-0"
                        :disabled="question.options.length <= 2"
                        :aria-label="`Remove choice ${optionIndex + 1}`"
                        @click="removeQuestionOption(question, optionIndex)"
                      />
                    </div>
                  </div>
                </div>

                <label class="mt-4 flex cursor-pointer items-center gap-2.5 text-[13px] text-toned">
                  <UCheckbox v-model="question.required" />
                  Guests must answer this question
                </label>
              </div>
            </div>

            <div
              v-else
              class="px-5 py-7 text-center"
            >
              <UIcon
                name="i-lucide-message-circle-question"
                class="mx-auto size-5 text-dimmed"
              />
              <p class="mt-2 text-[13px] font-medium text-toned">
                No extra questions
              </p>
              <p class="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-muted">
                Guests will only provide their name, email and optional notes.
              </p>
            </div>
          </section>

          <section class="overflow-hidden rounded-xl border border-default bg-default">
            <div class="flex gap-3 border-b border-default px-5 py-4">
              <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><UIcon
                name="i-lucide-map-pinned"
                class="size-4"
              /></span>
              <div>
                <h3 class="text-[14px] font-semibold text-highlighted">
                  Meeting location
                </h3>
                <p class="mt-0.5 text-[12px] text-muted">
                  Make it obvious how guests should join or find you.
                </p>
              </div>
            </div>
            <div class="space-y-5 px-5 py-5">
              <UFormField
                label="Where will you meet?"
                name="locationType"
                required
              >
                <USelectMenu
                  v-model="form.locationType"
                  :items="locationOptions"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                />
              </UFormField>

              <div
                v-if="form.locationType === 'google_meet'"
                class="flex items-start gap-3 rounded-lg border border-success/20 bg-success/5 px-4 py-3"
              >
                <UIcon
                  name="i-simple-icons-googlemeet"
                  class="mt-0.5 size-4 shrink-0 text-success"
                />
                <div>
                  <p class="text-[13px] font-medium text-highlighted">
                    A private Meet link will be created for every booking.
                  </p>
                  <p class="mt-1 text-[12px] leading-relaxed text-muted">
                    It will be added to the calendar event, confirmation and booking details automatically.
                  </p>
                </div>
              </div>

              <div
                v-else-if="!googleMeetReady"
                class="flex items-center justify-between gap-3 rounded-lg border border-default bg-muted px-4 py-3"
              >
                <p class="text-[12px] leading-relaxed text-muted">
                  Want automatic Google Meet links? Connect a writable Google Calendar first.
                </p>
                <UButton
                  to="/integrations"
                  target="_blank"
                  color="neutral"
                  variant="outline"
                  size="xs"
                  class="shrink-0"
                >
                  Connect
                </UButton>
              </div>

              <UFormField
                v-if="form.locationType !== 'google_meet'"
                :label="locationField?.label"
                name="locationDetails"
                :help="locationField?.help"
                required
              >
                <UInput
                  v-if="form.locationType === 'video_link'"
                  v-model="form.locationDetails"
                  type="url"
                  :maxlength="500"
                  :placeholder="locationField?.placeholder"
                  class="w-full"
                />
                <UTextarea
                  v-else
                  v-model="form.locationDetails"
                  :rows="2"
                  :maxlength="500"
                  :placeholder="locationField?.placeholder"
                  class="w-full"
                />
              </UFormField>
            </div>

            <div class="border-t border-default bg-muted px-5 py-4">
              <p class="text-[13px] font-semibold text-highlighted">
                Email reminders
              </p>
              <p class="mt-0.5 text-[12px] text-muted">
                Guests can reschedule or cancel from every reminder.
              </p>
              <div class="mt-3 grid gap-2 sm:grid-cols-2">
                <label class="flex cursor-pointer items-center gap-3 rounded-lg border border-default bg-default px-3.5 py-3">
                  <UCheckbox
                    :model-value="reminderEnabled(1440)"
                    aria-label="Send a reminder one day before"
                    @update:model-value="toggleReminder(1440, Boolean($event))"
                  />
                  <span class="text-[13px] text-toned">1 day before</span>
                </label>
                <label class="flex cursor-pointer items-center gap-3 rounded-lg border border-default bg-default px-3.5 py-3">
                  <UCheckbox
                    :model-value="reminderEnabled(60)"
                    aria-label="Send a reminder one hour before"
                    @update:model-value="toggleReminder(60, Boolean($event))"
                  />
                  <span class="text-[13px] text-toned">1 hour before</span>
                </label>
              </div>
            </div>
          </section>

          <section class="overflow-hidden rounded-xl border border-default bg-default">
            <div class="flex gap-3 border-b border-default px-5 py-4">
              <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><UIcon
                name="i-lucide-calendar-range"
                class="size-4"
              /></span>
              <div>
                <h3 class="text-[14px] font-semibold text-highlighted">
                  Availability & limits
                </h3>
                <p class="mt-0.5 text-[12px] text-muted">
                  Protect your time while keeping booking effortless.
                </p>
              </div>
            </div>
            <div class="grid gap-x-5 gap-y-6 px-5 py-5 sm:grid-cols-2">
              <UFormField
                label="Availability schedule"
                name="scheduleId"
                help="Choose the working hours and timezone used for this event."
                required
                class="sm:col-span-2"
              >
                <USelectMenu
                  v-model="form.scheduleId"
                  :items="scheduleOptions"
                  value-key="value"
                  label-key="label"
                  icon="i-lucide-calendar-range"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="Minimum notice"
                name="minimumNoticeMinutes"
                help="How soon before the start time someone may book."
              >
                <UInput
                  v-model.number="form.minimumNoticeMinutes"
                  type="number"
                  min="0"
                  max="525600"
                  step="15"
                  size="lg"
                  class="w-full"
                >
                  <template #trailing>
                    <span class="text-xs text-dimmed">minutes</span>
                  </template>
                </UInput>
              </UFormField>
              <UFormField
                label="Booking window"
                name="bookingWindowDays"
                help="How far into the future people can book."
              >
                <UInput
                  v-model.number="form.bookingWindowDays"
                  type="number"
                  min="1"
                  max="730"
                  size="lg"
                  class="w-full"
                >
                  <template #trailing>
                    <span class="text-xs text-dimmed">days</span>
                  </template>
                </UInput>
              </UFormField>
              <UFormField
                label="Time before each meeting"
                name="bufferBeforeMinutes"
                help="Keep this time free to get ready."
              >
                <UInput
                  v-model.number="form.bufferBeforeMinutes"
                  type="number"
                  min="0"
                  max="1440"
                  step="5"
                  size="lg"
                  class="w-full"
                >
                  <template #trailing>
                    <span class="text-xs text-dimmed">minutes</span>
                  </template>
                </UInput>
              </UFormField>
              <UFormField
                label="Time after each meeting"
                name="bufferAfterMinutes"
                help="Keep this time free to wrap up or take a break."
              >
                <UInput
                  v-model.number="form.bufferAfterMinutes"
                  type="number"
                  min="0"
                  max="1440"
                  step="5"
                  size="lg"
                  class="w-full"
                >
                  <template #trailing>
                    <span class="text-xs text-dimmed">minutes</span>
                  </template>
                </UInput>
              </UFormField>
              <UFormField
                label="Daily booking limit"
                name="maxPerDay"
                hint="Optional"
                help="Leave empty for no daily limit."
              >
                <UInput
                  v-model.number="form.maxPerDay"
                  type="number"
                  min="1"
                  max="100"
                  size="lg"
                  placeholder="No limit"
                  class="w-full"
                />
              </UFormField>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-3 border-t border-default bg-muted px-5 py-4">
              <div>
                <p class="text-[13px] font-medium text-highlighted">
                  {{ selectedSchedule?.name ?? 'Availability schedule' }}
                </p><p class="mt-0.5 text-[12px] text-muted">
                  {{ selectedSchedule ? `${selectedSchedule.timeZone.replace(/_/g, ' ')} · ${selectedSchedule.rules.length} weekly windows` : 'Available times come from Availability.' }}
                </p>
              </div>
              <UButton
                to="/availability"
                color="neutral"
                variant="outline"
                size="sm"
                icon="i-lucide-arrow-up-right"
                target="_blank"
              >
                Review schedule
              </UButton>
            </div>
          </section>

          <section class="overflow-hidden rounded-xl border border-default bg-default">
            <label class="flex cursor-pointer items-start justify-between gap-5 px-5 py-5">
              <span>
                <span class="flex items-center gap-2 text-[14px] font-semibold text-highlighted"><UIcon
                  name="i-lucide-eye-off"
                  class="size-4 text-muted"
                />Hide from public profile</span>
                <span class="mt-1.5 block max-w-xl text-[12px] leading-relaxed text-muted">Keep this event private while you finish setting it up. Existing bookings are unaffected.</span>
              </span>
              <USwitch
                v-model="form.hidden"
                aria-label="Hide event type from public profile"
              />
            </label>
          </section>

          <p
            v-if="error"
            class="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-[13px] text-error"
            role="alert"
          >
            {{ error }}
          </p>
        </div>

        <aside class="hidden border-l border-default bg-muted px-5 py-6 lg:block">
          <div class="sticky top-0">
            <div class="mb-3 flex items-center justify-between">
              <p class="text-[11px] font-semibold uppercase tracking-[0.12em] text-dimmed">
                Guest preview
              </p>
              <span class="flex items-center gap-1.5 text-[10px] text-dimmed"><span class="size-1.5 rounded-full bg-primary" />Live</span>
            </div>
            <div class="overflow-hidden rounded-2xl border border-default bg-default shadow-sm">
              <div class="border-b border-default px-5 py-5">
                <div class="flex items-center gap-3">
                  <span class="flex size-10 items-center justify-center rounded-full bg-primary text-[12px] font-semibold text-white">{{ initials }}</span>
                  <div class="min-w-0">
                    <p class="truncate text-[12px] text-muted">
                      {{ currentUser?.user?.name }}
                    </p><h3 class="truncate text-[16px] font-semibold text-highlighted">
                      {{ form.title || 'Untitled event' }}
                    </h3>
                  </div>
                </div>
                <p class="mt-4 line-clamp-3 min-h-10 text-[12px] leading-relaxed text-muted">
                  {{ form.description || 'Your event description will appear here for guests.' }}
                </p>
                <div class="mt-4 flex items-center gap-4 text-[11px] text-toned">
                  <span class="flex items-center gap-1.5"><UIcon
                    name="i-lucide-clock-3"
                    class="size-3.5 text-dimmed"
                  />{{ form.durationMinutes || 0 }} min</span>
                  <span class="flex items-center gap-1.5"><UIcon
                    name="i-lucide-globe-2"
                    class="size-3.5 text-dimmed"
                  />Local time</span>
                </div>
              </div>
              <div class="px-4 py-4">
                <div class="flex items-center justify-between px-1">
                  <p class="text-[12px] font-semibold text-highlighted">
                    August 2026
                  </p><span class="flex gap-2 text-dimmed"><UIcon name="i-lucide-chevron-left" /><UIcon name="i-lucide-chevron-right" /></span>
                </div>
                <div class="mt-3 grid grid-cols-5 gap-1">
                  <div
                    v-for="day in previewDays"
                    :key="day.date"
                    class="rounded-lg py-2 text-center"
                    :class="day.active ? 'bg-primary text-white' : 'bg-muted text-muted'"
                  >
                    <span class="block text-[8px] font-semibold tracking-wider opacity-70">{{ day.day }}</span><span class="tnum mt-0.5 block text-[13px] font-semibold">{{ day.date }}</span>
                  </div>
                </div>
                <div class="mt-4 grid grid-cols-3 gap-2">
                  <span
                    v-for="time in ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']"
                    :key="time"
                    class="tnum rounded-lg border border-default py-2 text-center text-[11px] font-medium text-toned"
                  >{{ time }}</span>
                </div>
              </div>
              <div class="truncate border-t border-default bg-muted px-4 py-3 text-center font-mono text-[9px] text-dimmed">
                {{ bookingUrl }}
              </div>
            </div>
            <div class="mt-4 flex gap-2 rounded-xl border border-default bg-default px-3.5 py-3 text-[11px] leading-relaxed text-muted">
              <UIcon
                name="i-lucide-info"
                class="mt-0.5 size-3.5 shrink-0 text-primary"
              />Guests see times in their own time zone. Your working hours and break times are applied automatically.
            </div>
          </div>
        </aside>
      </form>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-between gap-3">
        <p class="hidden text-[12px] text-muted sm:block">
          {{ dirty ? 'You have unsaved changes' : 'No unsaved changes' }}
        </p>
        <div class="ml-auto flex items-center gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="saving"
            @click="isOpen = false"
          >
            Cancel
          </UButton>
          <UButton
            type="submit"
            form="event-type-form"
            :loading="saving"
            :disabled="!valid || (!dirty && Boolean(eventType))"
            icon="i-lucide-check"
            class="min-w-32 justify-center font-medium"
          >
            {{ eventType ? 'Save changes' : 'Create event type' }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
