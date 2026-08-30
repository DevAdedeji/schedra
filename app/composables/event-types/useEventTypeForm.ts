import { computed, reactive, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { formatMoney } from '#shared/payments'
import {
  eventTypeSchema,
  type BookingQuestion,
  type BookingQuestionType,
  type EventTypeInput
} from '#shared/validation'
import type { CalendarConnection, VideoConferenceConnection } from '~/services/schedra-api'
import type { EventTypeRecord } from '~/types/event-type'
import type { ScheduleRecord } from '~/types/schedule'

export type EventTypeForm = Omit<EventTypeInput, 'bookingWindowDays' | 'maxPerDay'> & {
  bookingWindowDays?: number
  maxPerDay?: number
}

export const EVENT_TYPE_ADVANCED_SECTIONS = ['questions', 'availability', 'notifications', 'payments', 'rules'] as const
export type EventTypeAdvancedSection = typeof EVENT_TYPE_ADVANCED_SECTIONS[number]

const QUESTION_TYPE_OPTIONS = [
  { label: 'Short answer', value: 'short_text' },
  { label: 'Long answer', value: 'long_text' },
  { label: 'Choose one', value: 'select' }
]

const LOCATION_FIELDS = {
  video_link: { label: 'Meeting link', help: 'Guests receive this link after booking.', placeholder: 'https://zoom.us/j/…' },
  phone: { label: 'Call instructions', help: 'Explain who calls whom and which number to use.', placeholder: 'I will call you on the number we have on file.' },
  in_person: { label: 'Address', help: 'Include enough detail for guests to find you.', placeholder: '12 Marina Road, Lagos · Reception, 2nd floor' },
  custom: { label: 'Meeting instructions', help: 'Tell guests exactly how or where you will meet.', placeholder: 'I will share the meeting details before the call.' }
} as const

function slugifyEventType(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 64)
}

function shortDuration(minutes: number) {
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440}d`
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}

export function useEventTypeForm(options: {
  eventType: MaybeRefOrGetter<EventTypeRecord | null | undefined>
  schedules: MaybeRefOrGetter<ScheduleRecord[] | null | undefined>
  googleConnection: MaybeRefOrGetter<CalendarConnection | null | undefined>
  microsoftConnection: MaybeRefOrGetter<CalendarConnection | null | undefined>
  zoomConnection: MaybeRefOrGetter<VideoConferenceConnection | null | undefined>
}) {
  function schedules() {
    return toValue(options.schedules) ?? []
  }

  function emptyForm(): EventTypeForm {
    const scheduleId = schedules().find(schedule => schedule.isDefault)?.id ?? schedules()[0]?.id
    return {
      title: '', slug: '', description: '', durationMinutes: 30, additionalDurationMinutes: [],
      recurringBookingEnabled: false, recurringBookingMaxOccurrences: 8, incrementMinutes: null,
      bufferBeforeMinutes: 0, bufferAfterMinutes: 0, minimumNoticeMinutes: 120,
      bookingWindowDays: 60, maxPerDay: undefined,
      locationType: 'custom', locationDetails: 'The host will share meeting details before the meeting.',
      reminderMinutes: [1440, 60], bookingQuestions: [], requiresConfirmation: false,
      capacity: 1, paymentEnabled: false, priceCents: null, paymentCurrency: 'USD',
      scheduleId, hidden: false
    }
  }

  const form = reactive<EventTypeForm>(emptyForm())
  const initial = ref('')
  const slugTouched = ref(false)
  const openSections = ref<EventTypeAdvancedSection[]>([])

  const scheduleOptions = computed(() => schedules().map(schedule => ({
    label: schedule.isDefault ? `${schedule.name} (default)` : schedule.name,
    value: schedule.id
  })))
  const selectedSchedule = computed(() => schedules().find(schedule => schedule.id === form.scheduleId))
  const valid = computed(() => eventTypeSchema.safeParse(form).success && Boolean(form.scheduleId))
  const dirty = computed(() => JSON.stringify(form) !== initial.value)
  const locationOptions = [
    { label: 'Google Meet', value: 'google_meet', icon: 'i-simple-icons-googlemeet' },
    { label: 'Microsoft Teams', value: 'microsoft_teams', icon: 'i-simple-icons-microsoftteams' },
    { label: 'Zoom', value: 'zoom', icon: 'i-simple-icons-zoom' },
    { label: 'Video link', value: 'video_link', icon: 'i-lucide-video' },
    { label: 'Phone call', value: 'phone', icon: 'i-lucide-phone' },
    { label: 'In person', value: 'in_person', icon: 'i-lucide-map-pin' },
    { label: 'Custom instructions', value: 'custom', icon: 'i-lucide-message-square-text' }
  ]
  const locationField = computed(() => LOCATION_FIELDS[
    ['google_meet', 'microsoft_teams', 'zoom'].includes(form.locationType)
      ? 'custom'
      : form.locationType as keyof typeof LOCATION_FIELDS
  ])
  const selectedGeneratedProvider = computed(() => ({
    google_meet: {
      connected: Boolean(toValue(options.googleConnection)?.connected),
      unavailable: toValue(options.googleConnection)?.connected
        ? 'Choose Google Calendar as the calendar for new bookings to create Meet links.'
        : 'Connect Google Calendar and choose a calendar for new bookings to create Meet links.'
    },
    microsoft_teams: {
      connected: Boolean(toValue(options.microsoftConnection)?.connected),
      unavailable: toValue(options.microsoftConnection)?.connected && !toValue(options.microsoftConnection)?.supportsMicrosoftTeams
        ? 'This Microsoft calendar does not support Teams meetings. A Microsoft 365 calendar with Teams enabled is required.'
        : toValue(options.microsoftConnection)?.connected
          ? 'Choose Microsoft Calendar as the calendar for new bookings to create Teams links.'
          : 'Connect a Microsoft calendar with Teams enabled to create Teams links.'
    },
    zoom: {
      connected: Boolean(toValue(options.zoomConnection)?.connected),
      unavailable: 'Connect Zoom to create automatic meeting links.'
    }
  } as const)[form.locationType as 'google_meet' | 'microsoft_teams' | 'zoom'] ?? null)

  const breaksEnabled = computed({
    get: () => form.bufferBeforeMinutes > 0 || form.bufferAfterMinutes > 0,
    set: (enabled: boolean) => {
      if (!enabled) {
        form.bufferBeforeMinutes = 0
        form.bufferAfterMinutes = 0
      } else if (!form.bufferBeforeMinutes && !form.bufferAfterMinutes) {
        form.bufferAfterMinutes = 15
      }
    }
  })
  const dailyLimitEnabled = computed({
    get: () => typeof form.maxPerDay === 'number',
    set: (enabled: boolean) => { form.maxPerDay = enabled ? (form.maxPerDay ?? 1) : undefined }
  })
  const groupEventEnabled = computed({
    get: () => form.capacity > 1,
    set: (enabled) => {
      form.capacity = enabled ? 10 : 1
      if (enabled) form.recurringBookingEnabled = false
    }
  })
  const paidBookingEnabled = computed({
    get: () => form.paymentEnabled,
    set: (enabled: boolean) => {
      form.paymentEnabled = enabled
      form.priceCents = enabled ? (form.priceCents ?? 2500) : null
      if (enabled) {
        form.requiresConfirmation = false
        form.recurringBookingEnabled = false
      }
    }
  })
  const priceAmount = computed({
    get: () => form.priceCents === null ? undefined : form.priceCents / 100,
    set: (value: number | undefined) => { form.priceCents = value === undefined ? null : Math.round(value * 100) }
  })

  function sectionOpen(id: EventTypeAdvancedSection) {
    return openSections.value.includes(id)
  }

  function toggleSection(id: EventTypeAdvancedSection) {
    openSections.value = sectionOpen(id)
      ? openSections.value.filter(value => value !== id)
      : [...openSections.value, id]
  }

  const allSectionsOpen = computed(() => openSections.value.length === EVENT_TYPE_ADVANCED_SECTIONS.length)
  function toggleAllSections() {
    openSections.value = allSectionsOpen.value ? [] : [...EVENT_TYPE_ADVANCED_SECTIONS]
  }

  const sectionSummaries = computed(() => {
    const reminders = [...form.reminderMinutes].sort((a, b) => b - a).map(shortDuration)
    const attendance = form.capacity > 1 ? `${form.capacity} seats` : 'one guest'
    return {
      questions: form.bookingQuestions.length
        ? `${form.bookingQuestions.length} extra ${form.bookingQuestions.length === 1 ? 'question' : 'questions'}`
        : 'Name and email only',
      availability: `${selectedSchedule.value?.name ?? 'No schedule chosen'} · ${shortDuration(form.minimumNoticeMinutes)} notice · ${attendance}`,
      notifications: reminders.length ? `Reminders ${reminders.join(' and ')} before` : 'No reminders',
      payments: form.paymentEnabled && form.priceCents
        ? `${formatMoney(form.priceCents, form.paymentCurrency)} per booking`
        : 'Free to book',
      rules: `${form.requiresConfirmation ? 'You approve each booking' : 'Booked instantly'} · ${form.recurringBookingEnabled ? 'Repeating meetings available' : 'One booking at a time'} · ${form.hidden ? 'Hidden from your profile' : 'On your public profile'}`
    }
  })

  function loadForm() {
    const item = toValue(options.eventType)
    Object.assign(form, item
      ? {
          title: item.title, slug: item.slug, description: item.description ?? '',
          durationMinutes: item.durationMinutes, additionalDurationMinutes: [...item.additionalDurationMinutes],
          recurringBookingEnabled: item.recurringBookingEnabled,
          recurringBookingMaxOccurrences: item.recurringBookingMaxOccurrences,
          incrementMinutes: item.incrementMinutes,
          bufferBeforeMinutes: item.bufferBeforeMinutes, bufferAfterMinutes: item.bufferAfterMinutes,
          minimumNoticeMinutes: item.minimumNoticeMinutes,
          bookingWindowDays: item.bookingWindowDays ?? undefined, maxPerDay: item.maxPerDay ?? undefined,
          locationType: item.locationType, locationDetails: item.locationDetails,
          reminderMinutes: [...item.reminderMinutes],
          bookingQuestions: item.bookingQuestions.map(question => ({ ...question, options: [...question.options] })),
          requiresConfirmation: item.requiresConfirmation, capacity: item.capacity,
          paymentEnabled: item.paymentEnabled, priceCents: item.priceCents,
          paymentCurrency: item.paymentCurrency,
          scheduleId: item.scheduleId ?? schedules().find(schedule => schedule.isDefault)?.id ?? schedules()[0]?.id,
          hidden: item.hidden
        }
      : emptyForm())
    initial.value = JSON.stringify(form)
    slugTouched.value = Boolean(item)
    openSections.value = form.scheduleId ? [] : ['availability']
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
    form.bookingQuestions.push({ id: crypto.randomUUID(), label: '', type: 'short_text', required: false, options: [] })
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
    if (question.options.length < 20) question.options.push(`Option ${question.options.length + 1}`)
  }

  function removeQuestionOption(question: BookingQuestion, index: number) {
    if (question.options.length > 2) question.options.splice(index, 1)
  }

  watch(() => form.title, (title) => {
    if (!slugTouched.value && !toValue(options.eventType)) form.slug = slugifyEventType(title)
  })
  watch(() => form.requiresConfirmation, (required) => {
    if (required) form.recurringBookingEnabled = false
  })

  return {
    form, slugTouched, openSections, scheduleOptions, selectedSchedule, valid, dirty,
    locationOptions, questionTypeOptions: QUESTION_TYPE_OPTIONS, locationField,
    selectedGeneratedProvider, breaksEnabled, dailyLimitEnabled, groupEventEnabled,
    paidBookingEnabled, priceAmount, allSectionsOpen, sectionSummaries, sectionOpen,
    toggleSection, toggleAllSections, loadForm, reminderEnabled, toggleReminder,
    addQuestion, removeQuestion, moveQuestion, changeQuestionType,
    addQuestionOption, removeQuestionOption, slugify: slugifyEventType
  }
}
