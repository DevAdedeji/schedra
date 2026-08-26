<script setup lang="ts">
import {
  meetingLocationTypeSchema,
  teamEventTypeSchema,
  type AssignmentMode,
  type TeamEventTypeInput
} from '#shared/validation'
import {
  apiErrorMessage,
  teamEventTypesApi,
  type TeamEventTypeRecord,
  type TeamMemberRecord
} from '~/services/schedra-api'

const props = defineProps<{
  open: boolean
  teamSlug: string
  members: TeamMemberRecord[]
  eventType?: TeamEventTypeRecord | null
}>()
const emit = defineEmits<{ 'update:open': [value: boolean], 'saved': [action: 'created' | 'updated'] }>()

const { host } = useSiteUrl()
const feedback = useFeedback()

const isOpen = computed({ get: () => props.open, set: value => emit('update:open', value) })
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
    hidden: false,
    assignmentMode: 'round_robin',
    hosts: []
  }
}

const form = reactive<TeamEventTypeInput>(emptyForm())

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

const locationOptions = meetingLocationTypeSchema.options.map(value => ({
  label: {
    google_meet: 'Google Meet',
    video_link: 'Video link',
    phone: 'Phone call',
    in_person: 'In person',
    custom: 'Custom instructions'
  }[value],
  value
}))

// Reload whenever the modal opens so a stale edit never overwrites fresh data.
watch(() => props.open, async (open) => {
  if (!open) return
  error.value = ''
  slugTouched.value = Boolean(props.eventType)

  if (!props.eventType) {
    Object.assign(form, emptyForm())
    return
  }

  try {
    const detail = await $fetch<TeamEventTypeInput & { hosts: Array<{ memberId: string, scheduleId: string | null, enabled: boolean, weight: number }> }>(
      teamEventTypesApi.detailEndpoint(props.teamSlug, props.eventType.id)
    )
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
            v-if="form.locationType !== 'google_meet'"
            label="Meeting details"
            required
          >
            <UInput
              v-model="form.locationDetails"
              size="lg"
              class="w-full"
            />
          </UFormField>
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

        <section class="space-y-3">
          <div class="flex items-baseline justify-between gap-3">
            <h3 class="text-[13px] font-semibold text-highlighted">
              Hosts
            </h3>
            <p class="text-[11px] text-muted">
              Each host uses their own availability and calendar.
            </p>
          </div>

          <ul class="divide-y divide-default overflow-hidden rounded-xl border border-default">
            <li
              v-for="member in members"
              :key="member.id"
              class="flex items-center gap-3 px-4 py-3"
            >
              <UCheckbox
                :model-value="selectedIds.has(member.id)"
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
        </section>

        <section class="space-y-3">
          <UCheckbox
            v-model="form.requiresConfirmation"
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
      <div class="flex w-full items-center justify-between gap-3">
        <p class="min-w-0 truncate text-[12px] text-muted">
          {{ valid ? '' : validationMessage }}
        </p>
        <div class="flex shrink-0 gap-2">
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
            form="team-event-type-form"
            :loading="saving"
            :disabled="!valid"
          >
            {{ eventType ? 'Save changes' : 'Create' }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
