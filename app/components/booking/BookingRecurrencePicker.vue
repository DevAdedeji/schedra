<script setup lang="ts">
import {
  DEFAULT_RECURRING_OCCURRENCES,
  MAX_RECURRING_OCCURRENCES,
  MIN_RECURRING_OCCURRENCES,
  type RecurringBookingFrequency,
  type RecurringBookingRequest,
  type RecurringOccurrencePreview
} from '#shared/recurrence'

const props = defineProps<{
  maxOccurrences: number
  occurrences: RecurringOccurrencePreview[]
  timeZone: string
  error?: string
  disabled?: boolean
}>()

const model = defineModel<RecurringBookingRequest | null>({ required: true })
const maximum = computed(() => Math.min(
  MAX_RECURRING_OCCURRENCES,
  Math.max(MIN_RECURRING_OCCURRENCES, Math.trunc(props.maxOccurrences))
))

const repeatOptions: Array<{ label: string, value: 'once' | RecurringBookingFrequency }> = [
  { label: 'Once', value: 'once' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Every 2 weeks', value: 'biweekly' },
  { label: 'Monthly', value: 'monthly' },
  { label: 'Yearly', value: 'yearly' }
]

const countOptions = computed(() => Array.from(
  { length: maximum.value - MIN_RECURRING_OCCURRENCES + 1 },
  (_, index) => ({
    label: `${index + MIN_RECURRING_OCCURRENCES} meetings`,
    value: index + MIN_RECURRING_OCCURRENCES
  })
))

const occurrenceCount = computed({
  get: () => model.value?.occurrences ?? Math.min(DEFAULT_RECURRING_OCCURRENCES, maximum.value),
  set: (occurrences: number) => {
    model.value = { frequency: model.value?.frequency ?? 'weekly', occurrences }
  }
})

const repeatSelection = computed({
  get: () => model.value?.frequency ?? 'once',
  set: (frequency: 'once' | RecurringBookingFrequency) => {
    model.value = frequency === 'once'
      ? null
      : { frequency, occurrences: occurrenceCount.value }
  }
})

function repeatHelp(frequency: RecurringBookingFrequency) {
  return {
    weekly: 'Each week',
    biweekly: 'Every 2 weeks',
    monthly: 'Each month',
    yearly: 'Each year'
  }[frequency]
}

function when(value: string) {
  return new Intl.DateTimeFormat('en', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', timeZone: props.timeZone
  }).format(new Date(value))
}
</script>

<template>
  <fieldset
    class="rounded-xl border border-default bg-muted/40 p-4"
    :disabled="disabled"
  >
    <legend class="px-1 text-[14px] font-medium text-highlighted">
      How often?
    </legend>
    <USelect
      v-model="repeatSelection"
      :items="repeatOptions"
      value-key="value"
      label-key="label"
      size="lg"
      class="w-full"
      aria-label="Repeat booking"
      :disabled="disabled"
    />

    <div
      v-if="model"
      class="mt-4"
    >
      <UFormField
        label="Number of meetings"
        :help="`${repeatHelp(model.frequency)} at this time in your timezone.`"
      >
        <USelect
          v-model="occurrenceCount"
          :items="countOptions"
          value-key="value"
          label-key="label"
          class="w-full"
          :disabled="disabled"
        />
      </UFormField>

      <ol
        v-if="occurrences.length"
        class="mt-4 space-y-2"
        aria-label="Recurring meeting dates"
      >
        <li
          v-for="occurrence in occurrences"
          :key="occurrence.position"
          class="flex items-center gap-2 text-[13px]"
          :class="occurrence.available ? 'text-toned' : 'text-error'"
        >
          <UIcon
            :name="occurrence.available ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'"
            class="size-4 shrink-0"
            :class="occurrence.available ? 'text-success' : 'text-error'"
          />
          <span>Meeting {{ occurrence.position }} · {{ when(occurrence.startsAt) }}</span>
        </li>
      </ol>

      <p
        v-if="error"
        class="mt-3 text-[13px] leading-relaxed text-error"
        role="alert"
      >
        {{ error }}
      </p>
    </div>
  </fieldset>
</template>
