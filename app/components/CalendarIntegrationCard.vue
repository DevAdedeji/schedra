<script setup lang="ts">
import {
  apiErrorMessage,
  calendarIntegrationApi,
  type CalendarConnection,
  type CalendarIntegrationProvider,
  type CalendarItem
} from '~/services/schedra-api'

const props = defineProps<{
  provider: CalendarIntegrationProvider
  name: string
  icon: string
  iconClass: string
  description: string
  refreshSignal?: number
}>()

const emit = defineEmits<{ saved: [] }>()
const feedback = useFeedback()
const api = calendarIntegrationApi(props.provider)
const { data: connection, refresh: refreshConnection, status, error: connectionFailure } = await useLazyFetch<CalendarConnection>(api.connectionEndpoint)
const settingsOpen = ref(false)
const disconnectOpen = ref(false)
const calendars = ref<CalendarItem[]>([])
const selectedConflictIds = ref<string[]>([])
const writeCalendarId = ref('')
const baseline = ref('')
const loadingCalendars = ref(false)
const calendarsLoaded = ref(false)
const calendarFailure = ref('')
const pageError = ref('')
const saving = ref(false)
const disconnecting = ref(false)
const isGoogle = computed(() => props.provider === 'google-calendar')

const writableCalendars = computed(() => calendars.value
  .filter(calendar => ['writer', 'owner'].includes(calendar.accessRole))
  .map(calendar => ({
    label: calendar.primary ? `${calendar.summary} (Primary)` : calendar.summary,
    value: calendar.id
  })))

const conflictCalendars = computed<CalendarItem[]>(() => {
  const available = new Set(calendars.value.map(calendar => calendar.id))
  const missing = selectedConflictIds.value
    .filter(id => !available.has(id))
    .map(id => ({ id, summary: 'Calendar no longer available', primary: false, accessRole: 'reader' as const, unavailable: true }))
  return [...calendars.value, ...missing]
})

const currentSnapshot = computed(() => JSON.stringify({
  conflicts: [...selectedConflictIds.value].sort(),
  write: writeCalendarId.value
}))
const dirty = computed(() => currentSnapshot.value !== baseline.value)
const writeCalendarMissing = computed(() => Boolean(
  writeCalendarId.value && !writableCalendars.value.some(calendar => calendar.value === writeCalendarId.value)
))

function relationship(calendar: CalendarItem) {
  if (calendar.unavailable) return `No longer available in this ${props.name} account`
  if (calendar.primary) return 'Your primary calendar · Recommended'
  if (calendar.accessRole === 'owner') return 'Calendar you own'
  if (calendar.accessRole === 'writer') return calendar.shared ? 'Shared calendar you can edit' : 'Calendar you can edit'
  return 'Subscribed or shared calendar · Read-only'
}

function toggleConflict(id: string, selected: boolean) {
  selectedConflictIds.value = selected
    ? [...new Set([...selectedConflictIds.value, id])]
    : selectedConflictIds.value.filter(calendarId => calendarId !== id)
}

async function loadCalendars(force = false) {
  if (!connection.value?.connected || loadingCalendars.value || (calendarsLoaded.value && !force)) return
  loadingCalendars.value = true
  calendarFailure.value = ''
  try {
    const data = await api.calendars()
    calendars.value = data.items
    selectedConflictIds.value = [...data.conflictCalendarIds]
    writeCalendarId.value = data.writeCalendarId ?? ''
    baseline.value = currentSnapshot.value
    calendarsLoaded.value = true
  } catch (failure) {
    calendarFailure.value = apiErrorMessage(failure, `Could not load calendars from ${props.name} just now.`)
  } finally {
    loadingCalendars.value = false
  }
}

async function retryConnection() {
  await refreshConnection()
  await loadCalendars(true)
}

async function save() {
  if (!selectedConflictIds.value.length || !writeCalendarId.value) return
  saving.value = true
  pageError.value = ''
  try {
    const result = await api.update({ conflictCalendarIds: selectedConflictIds.value, writeCalendarId: writeCalendarId.value })
    baseline.value = currentSnapshot.value
    await refreshConnection()
    emit('saved')
    if (result.syncQueued) {
      feedback.success({ title: `${props.name} preferences saved` })
    } else {
      feedback.warning({
        title: `${props.name} preferences saved`,
        description: 'Existing bookings could not be queued for sync yet. Schedra will keep the saved preferences.'
      })
    }
  } catch (failure) {
    pageError.value = apiErrorMessage(failure, 'Could not save your calendar preferences just now.')
  } finally {
    saving.value = false
  }
}

async function disconnect() {
  disconnecting.value = true
  pageError.value = ''
  try {
    await api.disconnect()
    disconnectOpen.value = false
    settingsOpen.value = false
    calendars.value = []
    calendarsLoaded.value = false
    selectedConflictIds.value = []
    writeCalendarId.value = ''
    await refreshConnection()
    emit('saved')
    feedback.success({ title: `${props.name} disconnected` })
  } catch (failure) {
    pageError.value = apiErrorMessage(failure, `Could not disconnect ${props.name} just now.`)
  } finally {
    disconnecting.value = false
  }
}

watch(settingsOpen, (open) => {
  if (open && connection.value?.connected) void loadCalendars()
})

watch(() => props.refreshSignal, async (next, previous) => {
  if (!next || next === previous) return
  await refreshConnection()
  if (settingsOpen.value && connection.value?.connected) await loadCalendars(true)
})
</script>

<template>
  <section class="flex min-h-56 flex-col rounded-xl border border-default bg-default p-5">
    <div class="flex items-start justify-between gap-3">
      <span class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-black/5">
        <UIcon
          :name="icon"
          class="size-5.5"
          :class="iconClass"
        />
      </span>
      <span
        v-if="connection?.connected && connection.setupRequired"
        class="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning"
      ><span class="size-1.5 rounded-full bg-warning" />Setup required</span>
      <span
        v-else-if="connection?.connected"
        class="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success"
      ><span class="size-1.5 rounded-full bg-success" />Connected</span>
      <span
        v-else-if="connection?.status === 'needs_reauthorization'"
        class="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning"
      ><span class="size-1.5 rounded-full bg-warning" />Needs attention</span>
    </div>
    <h2 class="mt-4 text-[16px] font-semibold text-highlighted">
      {{ name }}
    </h2>
    <p class="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted">
      {{ connection?.accountLabel || description }}
    </p>
    <div class="mt-auto pt-5">
      <UButton
        v-if="connection?.connected"
        color="neutral"
        variant="soft"
        icon="i-lucide-settings-2"
        trailing-icon="i-lucide-chevron-right"
        block
        class="min-h-10"
        @click="settingsOpen = true"
      >
        {{ connection.setupRequired ? 'Finish setup' : 'Manage settings' }}
      </UButton>
      <UButton
        v-else-if="connection?.configured"
        :to="api.connectEndpoint"
        external
        icon="i-lucide-link"
        block
        class="min-h-10"
      >
        {{ connection?.status === 'needs_reauthorization' ? 'Reconnect' : 'Connect' }}
      </UButton>
      <UButton
        v-else
        color="neutral"
        variant="soft"
        block
        disabled
        class="min-h-10"
      >
        Not configured
      </UButton>
    </div>

    <UModal
      v-model:open="settingsOpen"
      :title="`${name} preferences`"
      description="Choose which calendars protect your time and where new booking events are created."
      :ui="{ content: 'w-full max-w-5xl', body: 'p-0 sm:p-0', footer: 'border-t border-default px-5 py-4 sm:px-6' }"
    >
      <template #body>
        <IntegrationPreferencesSkeleton v-if="status === 'pending'" />
        <AsyncErrorState
          v-else-if="connectionFailure"
          compact
          title="Could not load this integration"
          :description="`Check your connection and try loading ${name} again.`"
          :retrying="false"
          @retry="retryConnection"
        />
        <IntegrationPreferencesSkeleton v-else-if="loadingCalendars && !calendars.length" />
        <AsyncErrorState
          v-else-if="calendarFailure && !calendars.length"
          title="Could not load your calendars"
          :description="calendarFailure"
          :retrying="loadingCalendars"
          @retry="loadCalendars(true)"
        />
        <div
          v-else
          class="divide-y divide-default"
        >
          <div class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div class="flex min-w-0 items-center gap-3">
              <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success"><UIcon
                name="i-lucide-circle-check"
                class="size-4"
              /></span>
              <div class="min-w-0">
                <p class="text-[13px] font-medium text-highlighted">
                  Connected account
                </p>
                <p class="truncate text-[12px] text-muted">
                  {{ connection?.accountLabel }}
                </p>
              </div>
            </div>
            <UButton
              color="error"
              variant="soft"
              icon="i-lucide-unplug"
              @click="disconnectOpen = true"
            >
              Disconnect integration
            </UButton>
          </div>
          <AsyncErrorState
            v-if="calendarFailure"
            compact
            class="bg-error/5"
            title="Could not refresh your calendars"
            description="The last loaded preferences are still shown below."
            :retrying="loadingCalendars"
            @retry="loadCalendars(true)"
          />
          <div
            v-else-if="connection?.lastError"
            class="flex items-start gap-3 bg-warning/5 px-5 py-3 text-[12px] text-warning sm:px-6"
          >
            <UIcon
              name="i-lucide-triangle-alert"
              class="mt-0.5 size-4 shrink-0"
            />{{ connection.lastError }}
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
            <div class="min-w-0 px-5 py-6 sm:px-6">
              <h3 class="text-[14px] font-semibold text-highlighted">
                Calendars that block booking times
              </h3>
              <p class="mt-1 text-[13px] leading-relaxed text-muted">
                Select calendars where a busy event means a guest should not be able to book you. Holiday and week-number calendars usually stay unchecked.
              </p>
            </div>
            <div class="surface-secondary min-w-0 px-4 py-5 sm:px-5">
              <div class="max-h-80 overflow-y-auto rounded-lg border border-default bg-default">
                <label
                  v-for="calendar in conflictCalendars"
                  :key="calendar.id"
                  class="flex cursor-pointer items-center gap-3 border-b border-default px-3.5 py-3 last:border-b-0 hover:bg-muted"
                >
                  <UCheckbox
                    :model-value="selectedConflictIds.includes(calendar.id)"
                    :aria-label="`Check ${calendar.summary} for conflicts`"
                    @update:model-value="toggleConflict(calendar.id, Boolean($event))"
                  />
                  <span
                    class="size-2.5 shrink-0 rounded-full"
                    :style="{ backgroundColor: calendar.unavailable ? '#737373' : (calendar.backgroundColor || (isGoogle ? '#4285F4' : '#0078D4')) }"
                  />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-[14px] font-medium text-highlighted">{{ calendar.summary }}</span>
                    <span class="mt-0.5 block truncate text-[12px] text-dimmed">{{ relationship(calendar) }}</span>
                  </span>
                  <span
                    v-if="calendar.primary"
                    class="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                  >Recommended</span>
                </label>
              </div>
              <p
                v-if="!selectedConflictIds.length"
                class="mt-2 text-[12px] text-error"
              >
                Choose at least one calendar to prevent conflicts.
              </p>
              <p
                v-else
                class="mt-2 text-[12px] text-dimmed"
              >
                {{ selectedConflictIds.length }} {{ selectedConflictIds.length === 1 ? 'calendar' : 'calendars' }} checked for conflicts.
              </p>
            </div>
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
            <div class="min-w-0 px-5 py-6 sm:px-6">
              <h3 class="text-[14px] font-semibold text-highlighted">
                Calendar for new bookings
              </h3>
              <p class="mt-1 text-[13px] leading-relaxed text-muted">
                Choose the single calendar where Schedra creates events. Saving this choice makes {{ name }} your booking destination.
              </p>
            </div>
            <div class="surface-secondary flex min-w-0 flex-col justify-center px-4 py-5 sm:px-5">
              <USelectMenu
                v-model="writeCalendarId"
                :items="writableCalendars"
                value-key="value"
                label-key="label"
                icon="i-lucide-calendar-days"
                placeholder="Choose a calendar"
                class="mobile-compact-action min-h-11 w-full text-center sm:min-h-8"
              />
              <p
                v-if="!writableCalendars.length || writeCalendarMissing"
                class="mt-2 text-[12px] text-error"
              >
                {{ writeCalendarMissing ? 'The previous destination is unavailable. Choose another.' : `This ${name} account has no calendar Schedra can edit.` }}
              </p>
            </div>
          </div>
          <div
            v-if="pageError"
            class="bg-error/10 px-5 py-3 text-[12px] text-error"
            role="alert"
          >
            {{ pageError }}
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full flex-wrap items-center justify-between gap-3">
          <UButton
            color="neutral"
            variant="soft"
            :disabled="saving"
            @click="settingsOpen = false"
          >
            Close
          </UButton>
          <UButton
            :loading="saving"
            :disabled="(!dirty && !connection?.setupRequired) || !selectedConflictIds.length || !writeCalendarId || writeCalendarMissing"
            @click="save"
          >
            Save preferences
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="disconnectOpen"
      :title="`Disconnect ${name}?`"
      description="Schedra will stop checking this provider and syncing booking changes to it."
    >
      <template #body>
        <p class="text-[13px] leading-relaxed text-muted">
          Previously created events remain in the provider and can be removed there manually.
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="disconnecting"
            @click="disconnectOpen = false"
          >
            Keep connected
          </UButton>
          <UButton
            color="error"
            :loading="disconnecting"
            @click="disconnect"
          >
            Disconnect
          </UButton>
        </div>
      </template>
    </UModal>
  </section>
</template>
