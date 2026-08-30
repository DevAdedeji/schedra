<script setup lang="ts">
import { eventTypeSchema } from '#shared/validation'
import { apiErrorMessage, calendarIntegrationApi, eventTypesApi, paymentsApi, schedulesApi, zoomApi, type CalendarConnection, type PaymentAccountSummary, type SchedulesResponse, type VideoConferenceConnection } from '~/services/schedra-api'
import type { EventTypeRecord } from '~/types/event-type'
import { DEFAULT_LIST_PAGE_SIZE } from '~/constants/lists'

const props = defineProps<{ open: boolean, eventType?: EventTypeRecord | null }>()
const emit = defineEmits<{ 'update:open': [value: boolean], 'saved': [action: 'created' | 'updated'] }>()

const currentUserRequest = useCurrentUser()
const schedulesRequest = useFetch<SchedulesResponse>(schedulesApi.listEndpoint, {
  query: { pageSize: DEFAULT_LIST_PAGE_SIZE },
  immediate: false
})
const googleCalendarApi = calendarIntegrationApi('google-calendar')
const microsoftCalendarApi = calendarIntegrationApi('microsoft-calendar')
const googleConnectionRequest = useFetch<CalendarConnection>(googleCalendarApi.connectionEndpoint, {
  immediate: false
})
const microsoftConnectionRequest = useFetch<CalendarConnection>(microsoftCalendarApi.connectionEndpoint, {
  immediate: false
})
const zoomConnectionRequest = useFetch<VideoConferenceConnection>(zoomApi.connectionEndpoint, {
  immediate: false
})
const paymentAccountRequest = useFetch<PaymentAccountSummary>(paymentsApi.endpoint, { immediate: false })
const [
  { data: currentUser },
  { data: schedules, refresh: refreshSchedules },
  { data: googleConnection, refresh: refreshGoogleConnection },
  { data: microsoftConnection, refresh: refreshMicrosoftConnection },
  { data: zoomConnection, refresh: refreshZoomConnection },
  { data: paymentAccount, refresh: refreshPaymentAccount }
] = await Promise.all([currentUserRequest, schedulesRequest, googleConnectionRequest, microsoftConnectionRequest, zoomConnectionRequest, paymentAccountRequest])
const saving = ref(false)
const error = ref('')

const isOpen = computed({ get: () => props.open, set: value => emit('update:open', value) })
const username = computed(() => currentUser.value?.user?.username ?? '')
const {
  form, slugTouched, scheduleOptions, selectedSchedule, valid, dirty, locationOptions,
  questionTypeOptions, locationField, selectedGeneratedProvider, breaksEnabled,
  dailyLimitEnabled, groupEventEnabled, paidBookingEnabled, priceAmount,
  allSectionsOpen, sectionSummaries, sectionOpen, toggleSection, toggleAllSections,
  loadForm, reminderEnabled, toggleReminder, addQuestion, removeQuestion,
  moveQuestion, changeQuestionType, addQuestionOption, removeQuestionOption, slugify
} = useEventTypeForm({
  eventType: () => props.eventType,
  schedules: () => schedules.value?.items,
  googleConnection,
  microsoftConnection,
  zoomConnection
})

watch(() => props.open, (open) => {
  if (open) {
    error.value = ''
    Promise.allSettled([
      refreshSchedules(),
      refreshGoogleConnection(),
      refreshMicrosoftConnection(),
      refreshZoomConnection(),
      refreshPaymentAccount()
    ]).then(loadForm)
  }
})
watch(() => props.eventType, () => {
  if (props.open) {
    error.value = ''
    loadForm()
  }
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
    :dismissible="false"
    :title="eventType ? 'Edit event type' : 'New event type'"
    :description="eventType ? 'Update how this meeting works for future bookings.' : 'Create a polished booking experience for your guests.'"
    :ui="{
      content: 'h-[calc(100dvh-2rem)] w-full max-w-none sm:h-auto sm:max-h-[min(92dvh,56rem)] sm:max-w-3xl',
      header: 'border-b border-default px-5 py-4 sm:px-6 sm:py-5',
      body: 'min-h-0 flex-1 overflow-y-auto p-0 sm:p-0',
      footer: 'border-t border-default px-5 py-4 sm:px-6'
    }"
  >
    <template #body>
      <form
        id="event-type-form"
        class="min-h-0"
        @submit.prevent="save"
      >
        <div class="flex flex-col gap-5 px-5 py-5 sm:px-6 sm:py-6">
          <section class="order-1 overflow-hidden rounded-xl border border-default bg-default">
            <div class="flex gap-3 border-b border-default px-5 py-4">
              <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><UIcon
                name="i-lucide-sparkles"
                class="size-4"
              /></span>
              <div>
                <h3 class="text-[15px] font-semibold text-highlighted">
                  Event details
                </h3>
                <p class="mt-0.5 text-[13px] text-muted">
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

          <section class="order-2 overflow-hidden rounded-xl border border-default bg-default">
            <div class="flex gap-3 border-b border-default px-5 py-4">
              <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><UIcon
                name="i-lucide-map-pinned"
                class="size-4"
              /></span>
              <div>
                <h3 class="text-[15px] font-semibold text-highlighted">
                  Meeting location
                </h3>
                <p class="mt-0.5 text-[13px] text-muted">
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
                v-if="selectedGeneratedProvider && !selectedGeneratedProvider.connected"
                class="flex items-center justify-between gap-3 rounded-lg border border-default bg-muted px-4 py-3"
              >
                <p class="text-[13px] leading-relaxed text-muted">
                  {{ selectedGeneratedProvider.unavailable }}
                </p>
                <UButton
                  to="/integrations"
                  target="_blank"
                  rel="noopener noreferrer"
                  color="neutral"
                  variant="outline"
                  size="xs"
                  class="shrink-0"
                >
                  Connect
                </UButton>
              </div>

              <UFormField
                v-if="!selectedGeneratedProvider"
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
          </section>

          <div class="order-3 flex items-center gap-3 pt-1">
            <span class="eyebrow shrink-0 text-dimmed">More settings</span>
            <span class="h-px flex-1 bg-border" />
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              class="shrink-0"
              @click="toggleAllSections"
            >
              {{ allSectionsOpen ? 'Collapse all' : 'Expand all' }}
            </UButton>
          </div>

          <div class="order-4 divide-y divide-default overflow-hidden rounded-xl border border-default bg-default">
            <section>
              <button
                type="button"
                class="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-elevated/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                :aria-expanded="sectionOpen('availability')"
                aria-controls="event-type-advanced-settings"
                @click="toggleSection('availability')"
              >
                <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><UIcon
                  name="i-lucide-calendar-range"
                  class="size-4"
                /></span>
                <span class="min-w-0 flex-1">
                  <span class="block text-[15px] font-semibold text-highlighted">Availability &amp; limits</span>
                  <span
                    class="mt-0.5 block truncate text-[13px]"
                    :class="form.scheduleId ? 'text-muted' : 'text-error'"
                  >{{ sectionSummaries.availability }}</span>
                </span>
                <UIcon
                  name="i-lucide-chevron-down"
                  class="size-4 shrink-0 text-muted transition-transform"
                  :class="sectionOpen('availability') && 'rotate-180'"
                />
              </button>
              <div
                v-show="sectionOpen('availability')"
                id="event-type-advanced-settings"
                class="grid gap-x-5 gap-y-6 border-t border-default px-5 py-5 sm:grid-cols-2"
              >
                <div class="rounded-xl border border-default bg-muted/40 sm:col-span-2">
                  <label class="flex cursor-pointer items-start justify-between gap-4 px-4 py-4">
                    <span>
                      <span class="block text-[14px] font-medium text-highlighted">Let several guests join the same time</span>
                      <span class="mt-0.5 block text-[13px] text-muted">Useful for classes, webinars, office hours and group sessions.</span>
                    </span>
                    <USwitch
                      v-model="groupEventEnabled"
                      aria-label="Offer multiple seats per time"
                    />
                  </label>
                  <div
                    v-if="groupEventEnabled"
                    class="border-t border-default px-4 py-4"
                  >
                    <UFormField
                      label="Seats available at each time"
                      name="capacity"
                      help="Each guest gets a private booking link; everyone joins one shared meeting."
                    >
                      <UInput
                        v-model.number="form.capacity"
                        type="number"
                        min="2"
                        max="500"
                        size="lg"
                        class="w-full sm:max-w-48"
                      />
                    </UFormField>
                  </div>
                </div>
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
                <div class="rounded-xl border border-default bg-muted/40 sm:col-span-2">
                  <label class="flex cursor-pointer items-start justify-between gap-4 px-4 py-4">
                    <span>
                      <span class="block text-[14px] font-medium text-highlighted">Add time between meetings</span>
                      <span class="mt-0.5 block text-[13px] text-muted">Protect time to prepare or wrap up.</span>
                    </span>
                    <USwitch
                      v-model="breaksEnabled"
                      aria-label="Add time between meetings"
                    />
                  </label>
                  <div
                    v-if="breaksEnabled"
                    class="grid gap-4 border-t border-default px-4 py-4 sm:grid-cols-2"
                  >
                    <UFormField
                      label="Before the meeting"
                      name="bufferBeforeMinutes"
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
                      label="After the meeting"
                      name="bufferAfterMinutes"
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
                  </div>
                </div>
                <div class="rounded-xl border border-default bg-muted/40 sm:col-span-2">
                  <label class="flex cursor-pointer items-start justify-between gap-4 px-4 py-4">
                    <span>
                      <span class="block text-[14px] font-medium text-highlighted">Limit bookings per day</span>
                      <span class="mt-0.5 block text-[13px] text-muted">Stop offering times after this event reaches its daily limit.</span>
                    </span>
                    <USwitch
                      v-model="dailyLimitEnabled"
                      aria-label="Limit bookings per day"
                    />
                  </label>
                  <div
                    v-if="dailyLimitEnabled"
                    class="border-t border-default px-4 py-4"
                  >
                    <UFormField
                      label="Maximum bookings each day"
                      name="maxPerDay"
                    >
                      <UInput
                        v-model.number="form.maxPerDay"
                        type="number"
                        min="1"
                        max="100"
                        size="lg"
                        class="w-full sm:max-w-48"
                      />
                    </UFormField>
                  </div>
                </div>
              </div>
              <div class="surface-secondary flex flex-wrap items-center justify-between gap-3 border-t border-default px-5 py-4">
                <div>
                  <p class="text-[14px] font-medium text-highlighted">
                    {{ selectedSchedule?.name ?? 'Availability schedule' }}
                  </p><p class="mt-0.5 text-[13px] text-muted">
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
                  rel="noopener noreferrer"
                >
                  Review schedule
                </UButton>
              </div>
            </section>

            <section>
              <button
                type="button"
                class="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-elevated/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                :aria-expanded="sectionOpen('questions')"
                aria-controls="event-type-guest-settings"
                @click="toggleSection('questions')"
              >
                <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><UIcon
                  name="i-lucide-list-checks"
                  class="size-4"
                /></span>
                <span class="min-w-0 flex-1">
                  <span class="block text-[15px] font-semibold text-highlighted">Guest questions</span>
                  <span class="mt-0.5 block truncate text-[13px] text-muted">{{ sectionSummaries.questions }}</span>
                </span>
                <UIcon
                  name="i-lucide-chevron-down"
                  class="size-4 shrink-0 text-muted transition-transform"
                  :class="sectionOpen('questions') && 'rotate-180'"
                />
              </button>

              <div
                v-show="sectionOpen('questions')"
                id="event-type-guest-settings"
                class="border-t border-default"
              >
                <div class="flex flex-col gap-3 border-b border-default px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <p class="text-[13px] leading-relaxed text-muted">
                    Name and email are always requested. Add up to 10 of your own.
                  </p>
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
                      <p class="text-[13px] font-semibold text-muted">
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
                        <p class="text-[13px] font-medium text-toned">
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

                    <label class="mt-4 flex cursor-pointer items-center gap-2.5 text-[14px] text-toned">
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
                  <p class="mt-2 text-[14px] font-medium text-toned">
                    No extra questions
                  </p>
                  <p class="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-muted">
                    Guests will only provide their name, email and optional notes.
                  </p>
                </div>
              </div>
            </section>

            <section>
              <button
                type="button"
                class="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-elevated/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                :aria-expanded="sectionOpen('notifications')"
                aria-controls="event-type-notifications"
                @click="toggleSection('notifications')"
              >
                <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><UIcon
                  name="i-lucide-bell-ring"
                  class="size-4"
                /></span>
                <span class="min-w-0 flex-1">
                  <span class="block text-[15px] font-semibold text-highlighted">Reminders</span>
                  <span class="mt-0.5 block truncate text-[13px] text-muted">{{ sectionSummaries.notifications }}</span>
                </span>
                <UIcon
                  name="i-lucide-chevron-down"
                  class="size-4 shrink-0 text-muted transition-transform"
                  :class="sectionOpen('notifications') && 'rotate-180'"
                />
              </button>
              <div
                v-show="sectionOpen('notifications')"
                id="event-type-notifications"
                class="grid gap-2 border-t border-default px-5 py-5 sm:grid-cols-2"
              >
                <label class="flex cursor-pointer items-center gap-3 rounded-lg border border-default bg-muted/40 px-3.5 py-3">
                  <UCheckbox
                    :model-value="reminderEnabled(1440)"
                    aria-label="Send a reminder one day before"
                    @update:model-value="toggleReminder(1440, Boolean($event))"
                  />
                  <span class="text-[14px] text-toned">1 day before</span>
                </label>
                <label class="flex cursor-pointer items-center gap-3 rounded-lg border border-default bg-muted/40 px-3.5 py-3">
                  <UCheckbox
                    :model-value="reminderEnabled(60)"
                    aria-label="Send a reminder one hour before"
                    @update:model-value="toggleReminder(60, Boolean($event))"
                  />
                  <span class="text-[14px] text-toned">1 hour before</span>
                </label>
              </div>
            </section>

            <section>
              <button
                type="button"
                class="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-elevated/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                :aria-expanded="sectionOpen('payments')"
                aria-controls="event-type-payments"
                @click="toggleSection('payments')"
              >
                <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><UIcon
                  name="i-lucide-credit-card"
                  class="size-4"
                /></span>
                <span class="min-w-0 flex-1">
                  <span class="block text-[15px] font-semibold text-highlighted">Payments</span>
                  <span class="mt-0.5 block truncate text-[13px] text-muted">{{ sectionSummaries.payments }}</span>
                </span>
                <UIcon
                  name="i-lucide-chevron-down"
                  class="size-4 shrink-0 text-muted transition-transform"
                  :class="sectionOpen('payments') && 'rotate-180'"
                />
              </button>
              <div
                v-show="sectionOpen('payments')"
                id="event-type-payments"
                class="border-t border-default"
              >
                <label class="flex cursor-pointer items-start justify-between gap-5 border-b border-default px-5 py-5">
                  <span>
                    <span class="flex items-center gap-2 text-[15px] font-semibold text-highlighted"><UIcon
                      name="i-lucide-credit-card"
                      class="size-4 text-muted"
                    />Require payment</span>
                    <span class="mt-1.5 block max-w-xl text-[13px] leading-relaxed text-muted">Guests pay during checkout. Their time is confirmed only after Schedra verifies payment.</span>
                  </span>
                  <USwitch
                    v-model="paidBookingEnabled"
                    :disabled="!paymentAccount?.ready && !form.paymentEnabled"
                    aria-label="Require payment to book"
                  />
                </label>
                <div
                  v-if="!paymentAccount?.ready && !form.paymentEnabled"
                  class="surface-secondary flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                >
                  <p class="text-[13px] text-muted">
                    {{ paymentAccount?.status === 'pending_review'
                      ? 'Bachs is reviewing your account or bank destination. Paid bookings stay disabled until both are approved.'
                      : paymentAccount?.status === 'unavailable'
                        ? 'Schedra could not verify your payout account with Bachs. Paid bookings stay disabled for safety.'
                        : 'Complete payout setup and add an approved bank destination in Bachs before charging for bookings.' }}
                  </p>
                  <UButton
                    to="/payments"
                    target="_blank"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    icon="i-lucide-arrow-up-right"
                  >
                    Set up payments
                  </UButton>
                </div>
                <div
                  v-else-if="form.paymentEnabled && !paymentAccount?.ready"
                  class="surface-secondary flex items-center gap-2 px-5 py-4 text-[13px] text-warning"
                >
                  <UIcon
                    name="i-lucide-shield-alert"
                    class="size-4 shrink-0"
                  />
                  Paid bookings are paused until Schedra verifies both the Bachs account and a usable payout destination.
                </div>
                <div
                  v-if="form.paymentEnabled"
                  class="grid gap-4 px-5 py-5 sm:grid-cols-[1fr_10rem]"
                >
                  <UFormField
                    label="Price"
                    name="priceCents"
                    required
                  >
                    <UInput
                      v-model.number="priceAmount"
                      type="number"
                      min="1"
                      max="1000000"
                      step="0.01"
                      size="lg"
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField
                    label="Currency"
                    name="paymentCurrency"
                  >
                    <USelect
                      v-model="form.paymentCurrency"
                      :items="[{ label: 'USD', value: 'USD' }, { label: 'NGN', value: 'NGN' }]"
                      size="lg"
                      class="w-full"
                    />
                  </UFormField>
                </div>
              </div>
            </section>

            <section>
              <button
                type="button"
                class="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-elevated/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                :aria-expanded="sectionOpen('rules')"
                aria-controls="event-type-rules"
                @click="toggleSection('rules')"
              >
                <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><UIcon
                  name="i-lucide-shield-question"
                  class="size-4"
                /></span>
                <span class="min-w-0 flex-1">
                  <span class="block text-[15px] font-semibold text-highlighted">Approval &amp; visibility</span>
                  <span class="mt-0.5 block truncate text-[13px] text-muted">{{ sectionSummaries.rules }}</span>
                </span>
                <UIcon
                  name="i-lucide-chevron-down"
                  class="size-4 shrink-0 text-muted transition-transform"
                  :class="sectionOpen('rules') && 'rotate-180'"
                />
              </button>
              <div
                v-show="sectionOpen('rules')"
                id="event-type-rules"
                class="border-t border-default"
              >
                <label class="flex cursor-pointer items-start justify-between gap-5 border-b border-default px-5 py-5">
                  <span>
                    <span class="flex items-center gap-2 text-[15px] font-semibold text-highlighted"><UIcon
                      name="i-lucide-shield-question"
                      class="size-4 text-muted"
                    />Approve bookings first</span>
                    <span class="mt-1.5 block max-w-xl text-[13px] leading-relaxed text-muted">Hold each requested time until you approve or decline it. Guests are told that their booking is awaiting confirmation.</span>
                  </span>
                  <USwitch
                    v-model="form.requiresConfirmation"
                    :disabled="form.paymentEnabled"
                    aria-label="Require approval before confirming bookings"
                  />
                </label>
                <label class="flex cursor-pointer items-start justify-between gap-5 px-5 py-5">
                  <span>
                    <span class="flex items-center gap-2 text-[15px] font-semibold text-highlighted"><UIcon
                      name="i-lucide-eye-off"
                      class="size-4 text-muted"
                    />Hide from public profile</span>
                    <span class="mt-1.5 block max-w-xl text-[13px] leading-relaxed text-muted">Keep this event private while you finish setting it up. Existing bookings are unaffected.</span>
                  </span>
                  <USwitch
                    v-model="form.hidden"
                    aria-label="Hide event type from public profile"
                  />
                </label>
              </div>
            </section>
          </div>

          <p
            v-if="error"
            class="order-9 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-[14px] text-error"
            role="alert"
          >
            {{ error }}
          </p>
        </div>
      </form>
    </template>

    <template #footer>
      <ModalFooter :hint="dirty ? 'You have unsaved changes' : undefined">
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
            form="event-type-form"
            :loading="saving"
            :disabled="!valid || (!dirty && Boolean(eventType))"
            class="min-w-32 justify-center font-medium"
          >
            {{ eventType ? 'Save changes' : 'Create event type' }}
          </UButton>
        </template>
      </ModalFooter>
    </template>
  </UModal>
</template>
