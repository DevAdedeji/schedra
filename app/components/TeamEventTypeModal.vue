<script setup lang="ts">
import {
  meetingLocationTypeSchema,
  teamEventTypeSchema,
  type AssignmentMode,
  type TeamEventTypeInput
} from '#shared/validation'
import {
  apiErrorMessage,
  paymentsApi,
  teamEventTypesApi,
  type PaymentAccountSummary,
  type TeamEventTypeRecord,
  type TeamMemberRecord
} from '~/services/schedra-api'

const props = defineProps<{
  open: boolean
  teamSlug: string
  members: TeamMemberRecord[]
  memberPage: number
  memberSearch: string
  memberTotal: number
  memberTotalPages: number
  membersLoading: boolean
  membersError: boolean
  eventType?: TeamEventTypeRecord | null
}>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:memberPage': [value: number]
  'update:memberSearch': [value: string]
  'retryMembers': []
  'saved': [action: 'created' | 'updated']
}>()

const { host } = useSiteUrl()
const feedback = useFeedback()
const paymentEndpoint = computed(() => paymentsApi.teamEndpoint(props.teamSlug))
const { data: paymentAccount, refresh: refreshPaymentAccount } = await useFetch<PaymentAccountSummary>(paymentEndpoint, { immediate: false })

const isOpen = computed({ get: () => props.open, set: value => emit('update:open', value) })
const memberPageModel = computed({ get: () => props.memberPage, set: value => emit('update:memberPage', value) })
const memberSearchModel = computed({ get: () => props.memberSearch, set: value => emit('update:memberSearch', value) })
const saving = ref(false)
const error = ref('')
const slugTouched = ref(false)

function emptyForm(): TeamEventTypeInput {
  return {
    title: '',
    slug: '',
    description: undefined,
    durationMinutes: 30,
    incrementMinutes: null,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    minimumNoticeMinutes: 120,
    bookingWindowDays: 60,
    maxPerDay: null,
    locationType: 'custom',
    locationDetails: 'The host will share meeting details before the meeting.',
    reminderMinutes: [1440, 60],
    bookingQuestions: [],
    requiresConfirmation: false,
    capacity: 1,
    paymentEnabled: false,
    priceCents: null,
    paymentCurrency: 'USD',
    hidden: false,
    assignmentMode: 'round_robin',
    hosts: []
  }
}

const form = reactive<TeamEventTypeInput>(emptyForm())
const groupEventEnabled = computed({
  get: () => form.capacity > 1,
  set: (enabled) => { form.capacity = enabled ? 10 : 1 }
})
const paidBookingEnabled = computed({
  get: () => form.paymentEnabled,
  set: (enabled: boolean) => {
    form.paymentEnabled = enabled
    form.priceCents = enabled ? (form.priceCents ?? 2500) : null
    if (enabled) form.requiresConfirmation = false
  }
})
const priceAmount = computed({
  get: () => form.priceCents === null ? undefined : form.priceCents / 100,
  set: (value: number | undefined) => { form.priceCents = value === undefined ? null : Math.round(value * 100) }
})

const assignmentOptions = [
  {
    value: 'single' as const,
    label: 'One host',
    icon: 'i-lucide-user',
    hint: 'The same person takes every booking.'
  },
  {
    value: 'round_robin' as const,
    label: 'Round robin',
    icon: 'i-lucide-shuffle',
    hint: 'Whoever is free and least recently booked gets it.'
  },
  {
    value: 'collective' as const,
    label: 'Everyone',
    icon: 'i-lucide-users',
    hint: 'Only offered when every host is free, and all of them attend.'
  }
]

const knownMembers = shallowRef(new Map<string, TeamMemberRecord>())
watch(() => props.members, (members) => {
  const next = new Map(knownMembers.value)
  for (const member of members) next.set(member.id, member)
  knownMembers.value = next
}, { immediate: true })
watch(() => props.teamSlug, () => {
  knownMembers.value = new Map()
})

const selectedMembers = computed(() => form.hosts
  .filter(host => host.enabled)
  .map(host => knownMembers.value.get(host.memberId))
  .filter((member): member is TeamMemberRecord => Boolean(member)))
const meetingOwners = computed(() => form.assignmentMode === 'collective'
  ? selectedMembers.value.slice(0, 1)
  : selectedMembers.value)
const googleMeetReady = computed(() => selectedMembers.value.length > 0
  && selectedMembers.value.every(member => member.integrations.googleMeet))
const microsoftTeamsReady = computed(() => selectedMembers.value.length > 0
  && selectedMembers.value.every(member => member.integrations.microsoftTeams))
const zoomReady = computed(() => meetingOwners.value.length > 0
  && meetingOwners.value.every(member => member.integrations.zoom))

const locationOptions = computed(() => meetingLocationTypeSchema.options.map(value => ({
  label: {
    google_meet: 'Google Meet',
    microsoft_teams: 'Microsoft Teams',
    zoom: 'Zoom',
    video_link: 'Video link',
    phone: 'Phone call',
    in_person: 'In person',
    custom: 'Custom instructions'
  }[value],
  value,
  disabled: value === 'google_meet'
    ? !googleMeetReady.value
    : value === 'microsoft_teams'
      ? !microsoftTeamsReady.value
      : value === 'zoom' ? !zoomReady.value : false
})))

// Reload whenever the modal opens so a stale edit never overwrites fresh data.
watch(() => props.open, async (open) => {
  if (!open) return
  error.value = ''
  slugTouched.value = Boolean(props.eventType)
  await refreshPaymentAccount().catch(() => undefined)

  if (!props.eventType) {
    Object.assign(form, emptyForm())
    return
  }

  try {
    const detail = await teamEventTypesApi.get(props.teamSlug, props.eventType.id)
    Object.assign(form, { ...emptyForm(), ...detail, hosts: detail.hosts ?? [] })
  } catch (failure) {
    error.value = apiErrorMessage(failure, 'Could not load that event type.')
  }
})

watch(() => form.title, (value) => {
  if (slugTouched.value) return
  form.slug = value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
})

// Switching to a single-host event cannot leave several people active.
watch(() => form.assignmentMode, (mode: AssignmentMode) => {
  if (mode !== 'single') return
  const first = form.hosts.find(host => host.enabled) ?? form.hosts[0]
  form.hosts = first ? [{ ...first, enabled: true }] : []
})

const selectedIds = computed(() => new Set(form.hosts.map(host => host.memberId)))

function toggleHost(member: TeamMemberRecord) {
  if (selectedIds.value.has(member.id)) {
    form.hosts = form.hosts.filter(host => host.memberId !== member.id)
    return
  }

  const entry = { memberId: member.id, scheduleId: null, enabled: true, weight: 100 }
  form.hosts = form.assignmentMode === 'single' ? [entry] : [...form.hosts, entry]
}

const bookingUrl = computed(() => `${host.value}/team/${props.teamSlug}/${form.slug || 'your-link'}`)
const valid = computed(() => teamEventTypeSchema.safeParse(form).success)
const validationMessage = computed(() => {
  const result = teamEventTypeSchema.safeParse(form)
  return result.success ? '' : result.error.issues[0]?.message ?? ''
})

async function save() {
  if (!valid.value || saving.value) return
  saving.value = true
  error.value = ''

  try {
    if (props.eventType) {
      await teamEventTypesApi.update(props.teamSlug, props.eventType.id, form)
      feedback.success({ title: 'Event type updated' })
      emit('saved', 'updated')
    } else {
      await teamEventTypesApi.create(props.teamSlug, form)
      feedback.success({ title: 'Event type created' })
      emit('saved', 'created')
    }
    isOpen.value = false
  } catch (failure) {
    error.value = apiErrorMessage(failure, 'Could not save that event type.')
  } finally {
    saving.value = false
  }
}

function initials(name: string) {
  return name.split(' ').map(part => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :dismissible="false"
    :title="eventType ? 'Edit team event type' : 'New team event type'"
    description="A shared booking link your team hosts together."
    scrollable
    :ui="{
      content: 'h-[calc(100dvh-2rem)] w-full max-w-none sm:h-[min(92dvh,50rem)] sm:max-w-3xl',
      body: 'min-h-0 flex-1 overflow-y-auto',
      footer: 'border-t border-default px-5 py-4 sm:px-6'
    }"
  >
    <template #body>
      <form
        id="team-event-type-form"
        class="space-y-6"
        @submit.prevent="save"
      >
        <section class="space-y-4">
          <UFormField
            label="Title"
            required
          >
            <UInput
              v-model="form.title"
              size="lg"
              placeholder="Discovery call"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Link"
            required
            :help="bookingUrl"
          >
            <UsernameField
              v-model="form.slug"
              size="lg"
              placeholder="discovery"
              :prefix="`${host}/team/${teamSlug}/`"
              @update:model-value="slugTouched = true"
            />
          </UFormField>

          <UFormField label="Description">
            <UTextarea
              v-model="form.description"
              :rows="2"
              placeholder="What this meeting is for."
              class="w-full"
            />
          </UFormField>

          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField
              label="Duration"
              required
            >
              <UInput
                v-model.number="form.durationMinutes"
                type="number"
                size="lg"
                :min="5"
                :max="720"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Location">
              <USelectMenu
                v-model="form.locationType"
                :items="locationOptions"
                value-key="value"
                size="lg"
                class="w-full"
              />
            </UFormField>
          </div>

          <UFormField
            v-if="!['google_meet', 'microsoft_teams', 'zoom'].includes(form.locationType)"
            label="Meeting details"
            required
          >
            <UInput
              v-model="form.locationDetails"
              size="lg"
              class="w-full"
            />
          </UFormField>

          <div
            v-if="['google_meet', 'microsoft_teams', 'zoom'].includes(form.locationType)"
            class="rounded-lg border border-default bg-muted px-4 py-3 text-[12px] leading-relaxed text-muted"
          >
            {{ form.locationType === 'zoom'
              ? 'Schedra creates and maintains one Zoom meeting through the assigned organizer’s connected account.'
              : form.locationType === 'microsoft_teams'
                ? 'Schedra creates one Teams meeting through the organizer’s Microsoft calendar and shares that link with every host.'
                : 'Schedra creates the meeting through each assigned host’s writable Google Calendar.' }}
          </div>

          <div
            v-else-if="selectedMembers.length && (!googleMeetReady || !microsoftTeamsReady || !zoomReady)"
            class="rounded-lg border border-default bg-muted px-4 py-3 text-[12px] leading-relaxed text-muted"
          >
            Generated meeting providers become available after the required hosts connect them from Integrations.
          </div>
        </section>

        <section class="space-y-3">
          <h3 class="text-[13px] font-semibold text-highlighted">
            How is a host chosen?
          </h3>
          <div class="grid gap-2 sm:grid-cols-3">
            <button
              v-for="option in assignmentOptions"
              :key="option.value"
              type="button"
              class="rounded-xl border p-3 text-left transition-colors"
              :class="form.assignmentMode === option.value
                ? 'border-primary bg-primary/5'
                : 'border-default hover:bg-muted'"
              @click="form.assignmentMode = option.value"
            >
              <UIcon
                :name="option.icon"
                class="size-4"
                :class="form.assignmentMode === option.value ? 'text-primary' : 'text-dimmed'"
              />
              <p class="mt-2 text-[13px] font-medium text-highlighted">
                {{ option.label }}
              </p>
              <p class="mt-0.5 text-[11px] leading-relaxed text-muted">
                {{ option.hint }}
              </p>
            </button>
          </div>
        </section>

        <section class="overflow-hidden rounded-xl border border-default bg-muted/40">
          <label class="flex cursor-pointer items-start justify-between gap-4 px-4 py-4">
            <span>
              <span class="block text-[13px] font-medium text-highlighted">Offer multiple seats at each time</span>
              <span class="mt-0.5 block text-[12px] leading-relaxed text-muted">Keep the assigned host or hosts together while several guests join one shared session.</span>
            </span>
            <USwitch
              v-model="groupEventEnabled"
              aria-label="Offer multiple seats per team event time"
            />
          </label>
          <div
            v-if="groupEventEnabled"
            class="border-t border-default px-4 py-4"
          >
            <UFormField
              label="Seats available at each time"
              help="Capacity includes the main guest for each reservation, not the hosts."
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
        </section>

        <section class="space-y-3">
          <div class="flex items-baseline justify-between gap-3">
            <h3 class="text-[13px] font-semibold text-highlighted">
              Hosts
            </h3>
            <p class="text-[11px] text-muted">
              {{ form.hosts.length }} selected · each host uses their own availability and calendar.
            </p>
          </div>

          <UInput
            v-model="memberSearchModel"
            icon="i-lucide-search"
            placeholder="Search team members"
            aria-label="Search team members"
            class="w-full"
          />

          <div
            v-if="membersError"
            class="flex items-center justify-between gap-3 rounded-xl border border-error/30 bg-error/5 px-4 py-3"
            role="alert"
          >
            <p class="text-[12px] text-error">
              Could not load team members.
            </p>
            <UButton
              color="neutral"
              variant="outline"
              size="xs"
              icon="i-lucide-refresh-cw"
              @click="emit('retryMembers')"
            >
              Try again
            </UButton>
          </div>

          <div
            v-else-if="membersLoading && !members.length"
            class="space-y-2"
            aria-label="Loading team members"
          >
            <USkeleton
              v-for="index in 3"
              :key="index"
              class="h-14 w-full rounded-xl"
            />
          </div>

          <ListEmptyState
            v-else-if="!members.length"
            icon="i-lucide-users"
            :title="memberSearch ? 'No matching team members' : 'No team members available'"
            :description="memberSearch ? 'Try another name or email.' : 'Invite someone to the team before assigning them as a host.'"
            class="border border-default"
          />

          <ul
            v-else
            class="divide-y divide-default overflow-hidden rounded-xl border border-default"
          >
            <li
              v-for="member in members"
              :key="member.id"
              class="flex items-center gap-3 px-4 py-3"
            >
              <UCheckbox
                :model-value="selectedIds.has(member.id)"
                :aria-label="`${member.name} as host`"
                @update:model-value="toggleHost(member)"
              />
              <span class="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10 text-[11px] font-semibold text-primary">
                <img
                  v-if="member.avatarUrl"
                  :src="member.avatarUrl"
                  alt=""
                  class="size-full object-cover"
                >
                <template v-else>
                  {{ initials(member.name) }}
                </template>
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-[13px] font-medium text-highlighted">
                  {{ member.name }}
                </p>
                <p class="truncate text-[11px] text-muted">
                  {{ member.email }}
                </p>
              </div>
            </li>
          </ul>

          <ListPagination
            v-if="memberTotalPages > 1"
            :page="memberPageModel"
            :total-pages="memberTotalPages"
            :total="memberTotal"
            :disabled="membersLoading"
            @change="memberPageModel = $event"
          />
        </section>

        <section class="space-y-3">
          <div class="overflow-hidden rounded-xl border border-default bg-muted/40">
            <label class="flex cursor-pointer items-start justify-between gap-4 px-4 py-4">
              <span>
                <span class="block text-[13px] font-medium text-highlighted">Require payment</span>
                <span class="mt-0.5 block text-[12px] leading-relaxed text-muted">The reservation is confirmed only after Schedra verifies checkout.</span>
              </span>
              <USwitch
                v-model="paidBookingEnabled"
                :disabled="!paymentAccount?.ready && !form.paymentEnabled"
                aria-label="Require payment to book this team event"
              />
            </label>
            <div
              v-if="!paymentAccount?.ready && !form.paymentEnabled"
              class="surface-secondary flex items-center justify-between gap-3 border-t border-default px-4 py-3"
            >
              <p class="text-[12px] text-muted">
                {{ paymentAccount?.status === 'pending_review'
                  ? 'Bachs is reviewing the team payout account. Paid bookings stay disabled until transfers and payouts are approved.'
                  : 'A team owner must complete payout setup in Bachs first.' }}
              </p>
              <UButton
                :to="`/t/${teamSlug}/payments`"
                target="_blank"
                color="neutral"
                variant="outline"
                size="sm"
                icon="i-lucide-arrow-up-right"
              >
                Set up
              </UButton>
            </div>
            <div
              v-else-if="form.paymentEnabled && !paymentAccount?.ready"
              class="surface-secondary flex items-center gap-2 border-t border-default px-4 py-3 text-[12px] text-warning"
            >
              <UIcon
                name="i-lucide-shield-alert"
                class="size-4 shrink-0"
              />
              Paid bookings are paused until Bachs approves the team payout account.
            </div>
            <div
              v-if="form.paymentEnabled"
              class="grid gap-4 border-t border-default px-4 py-4 sm:grid-cols-[1fr_10rem]"
            >
              <UFormField
                label="Price"
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
              <UFormField label="Currency">
                <USelect
                  v-model="form.paymentCurrency"
                  :items="[{ label: 'USD', value: 'USD' }, { label: 'NGN', value: 'NGN' }]"
                  size="lg"
                  class="w-full"
                />
              </UFormField>
            </div>
          </div>
          <UCheckbox
            v-model="form.requiresConfirmation"
            :disabled="form.paymentEnabled"
            label="Require the host to approve each booking"
          />
          <UCheckbox
            v-model="form.hidden"
            label="Hide this from the team's public page"
          />
        </section>

        <p
          v-if="error"
          class="text-[13px] text-error"
          role="alert"
        >
          {{ error }}
        </p>
      </form>
    </template>

    <template #footer>
      <ModalFooter :hint="valid ? undefined : validationMessage">
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
            form="team-event-type-form"
            :loading="saving"
            :disabled="!valid"
          >
            {{ eventType ? 'Save changes' : 'Create' }}
          </UButton>
        </template>
      </ModalFooter>
    </template>
  </UModal>
</template>
