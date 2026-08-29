<script setup lang="ts">
import { apiErrorMessage, bookingLinksApi, eventTypesApi, type AvailabilityResponse } from '~/services/schedra-api'

const props = defineProps<{ open: boolean, initialKind?: 'single_use' | 'one_off' }>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  'created': []
}>()

const { url: siteUrl } = useSiteUrl()
const { copied, copy } = useCopy()
const feedback = useFeedback()
const open = computed({ get: () => props.open, set: value => emit('update:open', value) })
const {
  data: options,
  status: optionsStatus,
  error: optionsError,
  refresh: refreshOptions
} = await useFetch<{
  items: Array<{ id: string, title: string, slug: string, durationMinutes: number, hidden: boolean, locationType: string, locationReady: boolean }>
}>(bookingLinksApi.optionsEndpoint)

const kind = ref<'single_use' | 'one_off'>('single_use')
const eventTypeId = ref('')
const label = ref('')
const expiryDays = ref('7')
const selectedStarts = ref<string[]>([])
const availability = ref<AvailabilityResponse | null>(null)
const loadingSlots = ref(false)
const slotError = ref('')
const submitting = ref(false)
const submitError = ref('')
const createdUrl = ref('')

const eventOptions = computed(() => (options.value?.items ?? []).map(item => ({
  label: `${item.title} · ${item.durationMinutes} min${item.hidden ? ' · Hidden' : ''}${item.locationReady ? '' : ' · Setup needed'}`,
  value: item.id
})))
const selectedEvent = computed(() => options.value?.items.find(item => item.id === eventTypeId.value))
function isoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

async function loadSlots() {
  if (kind.value !== 'one_off' || !eventTypeId.value) return
  loadingSlots.value = true
  slotError.value = ''
  selectedStarts.value = []
  const now = new Date()
  try {
    availability.value = await eventTypesApi.slots(eventTypeId.value, {
      from: isoDate(now),
      to: isoDate(new Date(now.getTime() + 30 * 86_400_000))
    })
  } catch (failure) {
    availability.value = null
    slotError.value = apiErrorMessage(failure, 'Could not load your available times.')
  } finally {
    loadingSlots.value = false
  }
}

watch([kind, eventTypeId], () => void loadSlots())

const groupedSlots = computed(() => {
  const groups = new Map<string, AvailabilityResponse['slots']>()
  const timeZone = availability.value?.timeZone ?? 'UTC'
  const day = new Intl.DateTimeFormat('en-CA', { timeZone })
  for (const slot of availability.value?.slots ?? []) {
    const key = day.format(new Date(slot.start))
    groups.set(key, [...(groups.get(key) ?? []), slot])
  }
  return [...groups.entries()]
})

function dayLabel(date: string) {
  return new Intl.DateTimeFormat('en', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC'
  }).format(new Date(`${date}T12:00:00Z`))
}

function timeLabel(iso: string) {
  return new Intl.DateTimeFormat('en', {
    hour: 'numeric', minute: '2-digit', timeZone: availability.value?.timeZone ?? 'UTC'
  }).format(new Date(iso))
}

function toggleSlot(start: string) {
  selectedStarts.value = selectedStarts.value.includes(start)
    ? selectedStarts.value.filter(value => value !== start)
    : selectedStarts.value.length < 40 ? [...selectedStarts.value, start] : selectedStarts.value
}

function chooseKind(value: string) {
  if (value === 'single_use' || value === 'one_off') kind.value = value
}

const canSubmit = computed(() => Boolean(eventTypeId.value)
  && selectedEvent.value?.locationReady !== false
  && (kind.value === 'single_use' || selectedStarts.value.length > 0))

function reset() {
  kind.value = props.initialKind ?? 'single_use'
  eventTypeId.value = options.value?.items[0]?.id ?? ''
  label.value = ''
  expiryDays.value = '7'
  selectedStarts.value = []
  availability.value = null
  slotError.value = ''
  submitError.value = ''
  createdUrl.value = ''
}

watch(() => props.open, (value) => {
  if (value) reset()
})

watch(options, (value) => {
  if (open.value && !eventTypeId.value) eventTypeId.value = value?.items[0]?.id ?? ''
})

async function create() {
  if (!canSubmit.value) return
  submitting.value = true
  submitError.value = ''
  try {
    const selected = (availability.value?.slots ?? []).filter(slot => selectedStarts.value.includes(slot.start))
    const expiry = kind.value === 'one_off'
      ? new Date(Math.max(...selected.map(slot => Date.parse(slot.end)))).toISOString()
      : new Date(Date.now() + Number(expiryDays.value) * 86_400_000).toISOString()
    const result = await bookingLinksApi.create({
      kind: kind.value,
      eventTypeId: eventTypeId.value,
      label: label.value.trim() || null,
      expiresAt: expiry,
      slots: selected
    })
    createdUrl.value = `${siteUrl.value}${result.path}`
    emit('created')
  } catch (failure) {
    submitError.value = apiErrorMessage(failure, 'Could not create this meeting link.')
  } finally {
    submitting.value = false
  }
}

async function copyCreated() {
  if (await copy(createdUrl.value)) feedback.success({ title: 'Private link copied' })
  else feedback.error({ title: 'Could not copy the link' })
}
</script>

<template>
  <UModal
    v-model:open="open"
    :dismissible="!submitting"
    :title="createdUrl ? 'Your private link is ready' : 'Create a private meeting link'"
    :description="createdUrl ? 'Copy it now. For security, Schedra never stores a recoverable copy of the private token.' : 'Share a controlled invitation without changing your regular booking page.'"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div
        v-if="createdUrl"
        class="space-y-5"
      >
        <div class="flex size-12 items-center justify-center rounded-xl bg-success/10 text-success">
          <UIcon
            name="i-lucide-check"
            class="size-5"
          />
        </div>
        <div class="rounded-xl border border-default bg-muted p-4">
          <p class="break-all font-mono text-[13px] leading-relaxed text-highlighted">
            {{ createdUrl }}
          </p>
        </div>
        <div class="flex items-start gap-2 rounded-xl border border-default px-4 py-3 text-[12px] leading-relaxed text-muted">
          <UIcon
            name="i-lucide-shield-check"
            class="mt-0.5 size-4 shrink-0 text-primary"
          />
          The link closes after its first booking. You can also revoke it from Meeting links before it is used.
        </div>
      </div>

      <div
        v-else
        class="space-y-5"
      >
        <div class="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1.5">
          <button
            v-for="option in [
              { value: 'single_use', label: 'Single-use link', description: 'Your normal availability' },
              { value: 'one_off', label: 'One-off meeting', description: 'Only times you choose' }
            ]"
            :key="option.value"
            type="button"
            class="rounded-lg px-3 py-3 text-left transition-colors"
            :class="kind === option.value ? 'bg-default shadow-sm' : 'hover:bg-default/60'"
            @click="chooseKind(option.value)"
          >
            <span class="block text-[13px] font-semibold text-highlighted">{{ option.label }}</span>
            <span class="mt-0.5 block text-[11px] text-muted">{{ option.description }}</span>
          </button>
        </div>

        <USkeleton
          v-if="optionsStatus === 'pending' && !options"
          class="h-16 w-full"
        />
        <AsyncErrorState
          v-else-if="optionsError && !options"
          compact
          title="Could not load your event types"
          description="Check your connection and try again."
          :retrying="optionsStatus === 'pending'"
          @retry="refreshOptions"
        />
        <div
          v-else-if="!eventOptions.length"
          class="rounded-xl border border-default px-4 py-4"
        >
          <p class="text-[13px] font-semibold text-highlighted">
            Create an event type first
          </p>
          <p class="mt-1 text-[12px] leading-relaxed text-muted">
            Meeting links reuse an event type's duration, location and booking rules.
          </p>
          <UButton
            to="/event-types"
            color="neutral"
            variant="outline"
            class="mt-3"
            @click="open = false"
          >
            Go to event types
          </UButton>
        </div>
        <UFormField
          v-else
          label="Meeting type"
          required
        >
          <USelectMenu
            v-model="eventTypeId"
            :items="eventOptions"
            value-key="value"
            label-key="label"
            placeholder="Choose an event type"
            class="w-full"
          />
          <template #help>
            Duration, location, reminders and guest questions come from this event type.
          </template>
        </UFormField>

        <div
          v-if="selectedEvent?.locationReady === false"
          class="flex items-start justify-between gap-3 rounded-xl border border-warning/25 bg-warning/10 px-4 py-3"
        >
          <div class="flex min-w-0 items-start gap-2 text-[12px] leading-relaxed text-warning">
            <UIcon
              name="i-lucide-triangle-alert"
              class="mt-0.5 size-4 shrink-0"
            />
            <span>Choose this event type's meeting provider as the calendar for new bookings before creating its private link.</span>
          </div>
          <UButton
            to="/integrations"
            color="warning"
            variant="outline"
            size="xs"
            @click="open = false"
          >
            Manage
          </UButton>
        </div>

        <UFormField
          label="Private label"
          help="Optional. Only you can see this label."
        >
          <UInput
            v-model="label"
            maxlength="80"
            placeholder="e.g. Interview with Jordan"
            class="w-full"
          />
        </UFormField>

        <UFormField
          v-if="kind === 'single_use'"
          label="Link expires after"
          required
        >
          <USelectMenu
            v-model="expiryDays"
            :items="[
              { label: '24 hours', value: '1' },
              { label: '7 days', value: '7' },
              { label: '30 days', value: '30' },
              { label: '90 days', value: '90' }
            ]"
            value-key="value"
            label-key="label"
            class="w-full"
          />
        </UFormField>

        <div
          v-else
          class="rounded-xl border border-default"
        >
          <div class="border-b border-default px-4 py-3.5">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h3 class="text-[13px] font-semibold text-highlighted">
                  Times your guest can choose
                </h3>
                <p class="mt-0.5 text-[11px] text-muted">
                  Shown in {{ availability?.timeZone ?? 'your schedule timezone' }}.
                </p>
              </div>
              <UBadge
                color="neutral"
                variant="subtle"
              >
                {{ selectedStarts.length }} selected
              </UBadge>
            </div>
          </div>
          <div
            v-if="loadingSlots"
            class="space-y-3 p-4"
            aria-label="Loading available times"
          >
            <USkeleton
              v-for="item in 4"
              :key="item"
              class="h-10 w-full"
            />
          </div>
          <AsyncErrorState
            v-else-if="slotError"
            compact
            title="Could not load available times"
            :description="slotError"
            @retry="loadSlots"
          />
          <div
            v-else-if="groupedSlots.length"
            class="max-h-72 space-y-4 overflow-y-auto p-4"
          >
            <div
              v-for="[date, slots] in groupedSlots"
              :key="date"
              class="grid gap-2 sm:grid-cols-[7rem_1fr]"
            >
              <p class="pt-2 text-[12px] font-medium text-muted">
                {{ dayLabel(date) }}
              </p>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="slot in slots"
                  :key="slot.start"
                  type="button"
                  class="min-h-9 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors"
                  :class="selectedStarts.includes(slot.start) ? 'border-primary bg-primary text-inverted' : 'border-default text-toned hover:border-primary'"
                  :aria-pressed="selectedStarts.includes(slot.start)"
                  @click="toggleSlot(slot.start)"
                >
                  {{ timeLabel(slot.start) }}
                </button>
              </div>
            </div>
          </div>
          <p
            v-else
            class="px-4 py-10 text-center text-[13px] text-muted"
          >
            No available times in the next 30 days.
          </p>
        </div>

        <p
          v-if="submitError"
          class="rounded-lg border border-error/30 bg-error/10 px-3.5 py-3 text-[13px] text-error"
          role="alert"
        >
          {{ submitError }}
        </p>
      </div>
    </template>

    <template #footer>
      <ModalFooter>
        <template #cancel>
          <UButton
            color="neutral"
            variant="soft"
            :disabled="submitting"
            @click="open = false"
          >
            Close
          </UButton>
        </template>
        <template #actions>
          <UButton
            v-if="createdUrl"
            :color="copied ? 'success' : 'primary'"
            :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
            @click="copyCreated"
          >
            {{ copied ? 'Copied' : 'Copy private link' }}
          </UButton>
          <UButton
            v-else
            :loading="submitting"
            :disabled="!canSubmit"
            @click="create"
          >
            Create link
          </UButton>
        </template>
      </ModalFooter>
    </template>
  </UModal>
</template>
