<script setup lang="ts">
import {
  apiErrorMessage,
  paymentsApi,
  teamEventTypesApi,
  type PaymentAccountSummary,
  type TeamEventTypeRecord,
  type TeamMemberRecord
} from '~/services/schedra-api'
import { getInitials } from '~/utils/text'

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
const {
  form, slugTouched, groupEventEnabled, paidBookingEnabled, priceAmount,
  assignmentOptions, selectedMembers, googleMeetReady, microsoftTeamsReady,
  zoomReady, locationOptions, selectedIds, valid, validationMessage,
  resetForm, toggleHost
} = useTeamEventTypeForm({
  members: () => props.members,
  teamKey: () => props.teamSlug
})

// Reload whenever the modal opens so a stale edit never overwrites fresh data.
watch(() => props.open, async (open) => {
  if (!open) return
  error.value = ''
  slugTouched.value = Boolean(props.eventType)
  await refreshPaymentAccount().catch(() => undefined)

  if (!props.eventType) {
    resetForm()
    return
  }

  try {
    const detail = await teamEventTypesApi.get(props.teamSlug, props.eventType.id)
    resetForm(detail)
  } catch (failure) {
    error.value = apiErrorMessage(failure, 'Could not load that event type.')
  }
})

const bookingUrl = computed(() => `${host.value}/team/${props.teamSlug}/${form.slug || 'your-link'}`)

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
            class="rounded-lg border border-default bg-muted px-4 py-3 text-[13px] leading-relaxed text-muted"
          >
            {{ form.locationType === 'zoom'
              ? 'Schedra creates and maintains one Zoom meeting through the assigned organizer’s connected account.'
              : form.locationType === 'microsoft_teams'
                ? 'Schedra creates one Teams meeting through the organizer’s Microsoft calendar and shares that link with every host.'
                : 'Schedra creates the meeting through each assigned host’s writable Google Calendar.' }}
          </div>

          <div
            v-else-if="selectedMembers.length && (!googleMeetReady || !microsoftTeamsReady || !zoomReady)"
            class="rounded-lg border border-default bg-muted px-4 py-3 text-[13px] leading-relaxed text-muted"
          >
            Generated meeting providers become available after the required hosts connect them from Integrations.
          </div>
        </section>

        <section class="space-y-3">
          <h3 class="text-[14px] font-semibold text-highlighted">
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
              <p class="mt-2 text-[14px] font-medium text-highlighted">
                {{ option.label }}
              </p>
              <p class="mt-0.5 text-[12px] leading-relaxed text-muted">
                {{ option.hint }}
              </p>
            </button>
          </div>
        </section>

        <section class="overflow-hidden rounded-xl border border-default bg-muted/40">
          <label class="flex cursor-pointer items-start justify-between gap-4 px-4 py-4">
            <span>
              <span class="block text-[14px] font-medium text-highlighted">Offer multiple seats at each time</span>
              <span class="mt-0.5 block text-[13px] leading-relaxed text-muted">Keep the assigned host or hosts together while several guests join one shared session.</span>
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
            <h3 class="text-[14px] font-semibold text-highlighted">
              Hosts
            </h3>
            <p class="text-[12px] text-muted">
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
            <p class="text-[13px] text-error">
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
              <span class="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10 text-[12px] font-semibold text-primary">
                <img
                  v-if="member.avatarUrl"
                  :src="member.avatarUrl"
                  alt=""
                  class="size-full object-cover"
                >
                <template v-else>
                  {{ getInitials(member.name) }}
                </template>
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-[14px] font-medium text-highlighted">
                  {{ member.name }}
                </p>
                <p class="truncate text-[12px] text-muted">
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
                <span class="block text-[14px] font-medium text-highlighted">Require payment</span>
                <span class="mt-0.5 block text-[13px] leading-relaxed text-muted">The reservation is confirmed only after Schedra verifies checkout.</span>
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
              <p class="text-[13px] text-muted">
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
              class="surface-secondary flex items-center gap-2 border-t border-default px-4 py-3 text-[13px] text-warning"
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
          class="text-[14px] text-error"
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
