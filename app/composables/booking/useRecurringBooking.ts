import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import {
  MAX_RECURRING_OCCURRENCES,
  MIN_RECURRING_OCCURRENCES,
  RecurrenceGenerationError,
  recurringOccurrences,
  type RecurringBookingRequest,
  type RecurringOccurrencePreview
} from '#shared/recurrence'

interface OfferedSlot {
  start: string
  end: string
}

export function useRecurringBooking(options: {
  enabled: MaybeRefOrGetter<boolean>
  maxOccurrences: MaybeRefOrGetter<number>
  selectedStart: MaybeRefOrGetter<string | null | undefined>
  durationMinutes: MaybeRefOrGetter<number | null | undefined>
  timeZone: MaybeRefOrGetter<string>
  offeredSlots: MaybeRefOrGetter<OfferedSlot[] | null | undefined>
}) {
  const recurrence = ref<RecurringBookingRequest | null>(null)

  const allowedMaximum = computed(() => Math.min(
    MAX_RECURRING_OCCURRENCES,
    Math.max(MIN_RECURRING_OCCURRENCES, Math.trunc(toValue(options.maxOccurrences)))
  ))

  watch([() => toValue(options.enabled), allowedMaximum], ([enabled, maximum]) => {
    if (!enabled) {
      recurrence.value = null
      return
    }
    if (recurrence.value && recurrence.value.occurrences > maximum) {
      recurrence.value = { ...recurrence.value, occurrences: maximum }
    }
  }, { immediate: true })

  const previewResult = computed<{ items: RecurringOccurrencePreview[], error: string }>(() => {
    const request = recurrence.value
    const start = toValue(options.selectedStart)
    const durationMinutes = toValue(options.durationMinutes)
    if (!request || !start || !durationMinutes) return { items: [], error: '' }

    try {
      const occurrences = recurringOccurrences({
        start,
        timeZone: toValue(options.timeZone),
        durationMinutes,
        occurrences: request.occurrences,
        frequency: request.frequency
      })
      const offered = new Set((toValue(options.offeredSlots) ?? []).map(slot =>
        `${new Date(slot.start).getTime()}:${new Date(slot.end).getTime()}`
      ))
      return {
        items: occurrences.map(occurrence => ({
          ...occurrence,
          available: offered.has(`${new Date(occurrence.startsAt).getTime()}:${new Date(occurrence.endsAt).getTime()}`)
        })),
        error: ''
      }
    } catch (error) {
      return {
        items: [],
        error: error instanceof RecurrenceGenerationError
          ? `Meeting ${error.position} lands on a clock change. Choose another time.`
          : 'Those recurring dates could not be prepared. Choose another time.'
      }
    }
  })

  const preview = computed(() => previewResult.value.items)
  const generationError = computed(() => previewResult.value.error)
  const firstUnavailable = computed(() => preview.value.find(occurrence => !occurrence.available) ?? null)
  const validationMessage = computed(() => {
    if (!recurrence.value) return ''
    if (!toValue(options.enabled)) return 'This event does not offer recurring bookings.'
    if (!toValue(options.selectedStart)) return 'Choose the first meeting time.'
    if (generationError.value) return generationError.value
    if (firstUnavailable.value) {
      const label = new Intl.DateTimeFormat('en', {
        weekday: 'long', day: 'numeric', month: 'long',
        hour: '2-digit', minute: '2-digit', timeZone: toValue(options.timeZone)
      }).format(new Date(firstUnavailable.value.startsAt))
      return `${label} is not available. Choose another starting time or fewer meetings.`
    }
    return ''
  })
  const valid = computed(() => recurrence.value === null || (
    preview.value.length === recurrence.value.occurrences && !validationMessage.value
  ))
  const requestRecurrence = computed(() => valid.value ? recurrence.value : null)

  function resetRecurrence() {
    recurrence.value = null
  }

  return {
    recurrence,
    allowedMaximum,
    preview,
    firstUnavailable,
    validationMessage,
    valid,
    requestRecurrence,
    resetRecurrence
  }
}
