<script setup lang="ts">
import { apiErrorMessage, calendarApi, zoomApi, type CalendarConnection, type CalendarItem, type VideoConferenceConnection } from '~/services/schedra-api'

definePageMeta({ layout: 'app', middleware: 'auth' })
useSeoMeta({ title: 'Integrations', robots: 'noindex, nofollow' })

const route = useRoute()
const feedback = useFeedback()
const { data: connection, refresh: refreshConnection, status, error: connectionFailure } = await useLazyFetch<CalendarConnection>(calendarApi.connectionEndpoint)
const { data: zoomConnection, refresh: refreshZoomConnection, status: zoomStatus, error: zoomFailure } = await useLazyFetch<VideoConferenceConnection>(zoomApi.connectionEndpoint)
const calendars = ref<CalendarItem[]>([])
const selectedConflictIds = ref<string[]>([])
const writeCalendarId = ref('')
const baseline = ref('')
const loadingCalendars = ref(false)
const saving = ref(false)
const pageError = ref('')
const calendarFailure = ref('')
const disconnectOpen = ref(false)
const disconnecting = ref(false)
const zoomDisconnectOpen = ref(false)
const zoomDisconnecting = ref(false)
const zoomPageError = ref('')
const calendarsLoaded = ref(false)
const connectionRetrying = computed(() => status.value === 'pending')
const zoomRetrying = computed(() => zoomStatus.value === 'pending')

const callbackNotice = computed(() => {
  if (route.query.zoom === 'connected') return { tone: 'success', text: 'Zoom is connected. You can now create event types with automatic Zoom links.' }
  if (route.query.zoom === 'invalid-request') return { tone: 'error', text: 'That Zoom connection request expired. Please start again.' }
  if (route.query.zoom === 'connection-failed') return { tone: 'error', text: 'Zoom could not be connected. Check the app scopes and callback URL, then try again.' }
  if (route.query.calendar === 'connected') return { tone: 'success', text: 'Google Calendar is connected. Review which calendars Schedra should use.' }
  if (route.query.calendar === 'invalid-request') return { tone: 'error', text: 'That connection request expired. Please start again.' }
  if (route.query.calendar === 'connection-failed') return { tone: 'error', text: 'Google Calendar could not be connected. Please try again.' }
  return null
})

async function disconnectZoom() {
  zoomDisconnecting.value = true
  zoomPageError.value = ''
  try {
    await zoomApi.disconnect()
    zoomDisconnectOpen.value = false
    await refreshZoomConnection()
    feedback.success({ title: 'Zoom disconnected' })
  } catch (failure) {
    zoomPageError.value = apiErrorMessage(failure, 'Could not disconnect Zoom just now.')
  } finally {
    zoomDisconnecting.value = false
  }
}

const writableCalendars = computed(() => calendars.value
  .filter(calendar => ['writer', 'owner'].includes(calendar.accessRole))
  .map(calendar => ({ label: calendar.primary ? `${calendar.summary} (Primary)` : calendar.summary, value: calendar.id })))

const conflictCalendars = computed<CalendarItem[]>(() => {
  const available = new Set(calendars.value.map(calendar => calendar.id))
  const missing = selectedConflictIds.value
    .filter(id => !available.has(id))
    .map(id => ({
      id,
      summary: 'Calendar no longer available',
      primary: false,
      accessRole: 'reader' as const,
      unavailable: true
    }))
  return [...calendars.value, ...missing]
})

const writeCalendarMissing = computed(() => Boolean(
  writeCalendarId.value
  && !writableCalendars.value.some(calendar => calendar.value === writeCalendarId.value)
))

function calendarRelationship(calendar: CalendarItem) {
  if (calendar.unavailable) return 'No longer available in this Google account'
  if (calendar.primary) return 'Your primary calendar · Recommended'
  if (calendar.accessRole === 'owner') return 'Calendar you own'
  if (calendar.accessRole === 'writer') return 'Shared calendar you can edit'
  return 'Subscribed or shared calendar · Read-only'
}

const currentSnapshot = computed(() => JSON.stringify({
  conflicts: [...selectedConflictIds.value].sort(),
  write: writeCalendarId.value
}))
const dirty = computed(() => currentSnapshot.value !== baseline.value)

async function loadCalendars(force = false) {
  if (!connection.value?.connected) return
  if (loadingCalendars.value || (calendarsLoaded.value && !force)) return
  loadingCalendars.value = true
  calendarFailure.value = ''
  try {
    const data = await calendarApi.calendars()
    calendars.value = data.items
    selectedConflictIds.value = [...data.conflictCalendarIds]
    writeCalendarId.value = data.writeCalendarId ?? ''
    baseline.value = currentSnapshot.value
    calendarsLoaded.value = true
  } catch (failure) {
    calendarFailure.value = apiErrorMessage(failure, 'Could not load calendars from Google just now.')
  } finally {
    loadingCalendars.value = false
  }
}

async function retryConnection() {
  await refreshConnection()
  await loadCalendars(true)
}

function toggleConflict(id: string, selected: boolean) {
  selectedConflictIds.value = selected
    ? [...new Set([...selectedConflictIds.value, id])]
    : selectedConflictIds.value.filter(calendarId => calendarId !== id)
}

async function saveCalendars() {
  if (!selectedConflictIds.value.length || !writeCalendarId.value) return
  saving.value = true
  pageError.value = ''
  try {
    await calendarApi.update({
      conflictCalendarIds: selectedConflictIds.value,
      writeCalendarId: writeCalendarId.value
    })
    baseline.value = currentSnapshot.value
    await refreshConnection()
    feedback.success({ title: 'Calendar preferences saved' })
  } catch (failure) {
    pageError.value = apiErrorMessage(failure, 'Could not save your calendar settings just now.')
  } finally {
    saving.value = false
  }
}

async function disconnect() {
  disconnecting.value = true
  pageError.value = ''
  try {
    await calendarApi.disconnect()
    disconnectOpen.value = false
    calendars.value = []
    calendarsLoaded.value = false
    selectedConflictIds.value = []
    writeCalendarId.value = ''
    await refreshConnection()
    feedback.success({ title: 'Google Calendar disconnected' })
  } catch (failure) {
    pageError.value = apiErrorMessage(failure, 'Could not disconnect Google Calendar just now.')
  } finally {
    disconnecting.value = false
  }
}

watch(() => connection.value?.connected, (connected) => {
  if (connected) {
    void loadCalendars()
    return
  }
  calendarsLoaded.value = false
  calendars.value = []
  selectedConflictIds.value = []
  writeCalendarId.value = ''
}, { immediate: true })
</script>

<template>
  <div class="space-y-7">
    <PageHeader
      title="Integrations"
      description="Connect the tools that keep your schedule accurate and your meetings moving."
    />

    <div
      v-if="callbackNotice"
      class="flex items-start gap-3 rounded-xl border px-4 py-3 text-[13px]"
      :class="callbackNotice.tone === 'success' ? 'border-success/25 bg-success/10 text-success' : 'border-error/25 bg-error/10 text-error'"
      role="status"
    >
      <UIcon
        :name="callbackNotice.tone === 'success' ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'"
        class="mt-0.5 size-4 shrink-0"
      />
      {{ callbackNotice.text }}
    </div>

    <section class="overflow-hidden rounded-xl border border-default bg-default">
      <div class="flex flex-col gap-5 border-b border-default px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div class="flex min-w-0 items-center gap-4">
          <span class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-black/5">
            <UIcon
              name="i-simple-icons-googlecalendar"
              class="size-6 text-[#4285F4]"
            />
          </span>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-[16px] font-semibold text-highlighted">
                Google Calendar
              </h2>
              <span
                v-if="connection?.connected"
                class="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success"
              ><span class="size-1.5 rounded-full bg-success" />Connected</span>
              <span
                v-else-if="connection?.status === 'needs_reauthorization'"
                class="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning"
              ><span class="size-1.5 rounded-full bg-warning" />Needs attention</span>
            </div>
            <p
              class="mt-1 text-[13px] text-muted"
              :class="connection?.accountLabel ? 'truncate' : 'leading-relaxed'"
            >
              {{ connection?.accountLabel || 'Prevent double-booking and keep meetings in sync.' }}
            </p>
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-2">
          <UButton
            v-if="connection?.connected"
            color="error"
            variant="outline"
            size="sm"
            icon="i-lucide-unplug"
            class="min-h-11 font-medium sm:min-h-8"
            @click="disconnectOpen = true"
          >
            Disconnect
          </UButton>
          <UButton
            v-else-if="connection?.configured"
            to="/api/integrations/google-calendar/connect"
            external
            icon="i-lucide-link"
            class="min-h-11 sm:min-h-9"
          >
            {{ connection?.status === 'needs_reauthorization' ? 'Reconnect' : 'Connect' }}
          </UButton>
        </div>
      </div>

      <IntegrationPreferencesSkeleton v-if="status === 'pending'" />

      <AsyncErrorState
        v-else-if="connectionFailure"
        compact
        title="Could not load this integration"
        description="Check your connection and try loading Google Calendar again."
        :retrying="connectionRetrying"
        @retry="retryConnection"
      />

      <div
        v-else-if="!connection?.configured"
        class="flex items-start gap-3 px-6 py-6 sm:px-7"
      >
        <UIcon
          name="i-lucide-info"
          class="mt-0.5 size-4 shrink-0 text-muted"
        />
        <div>
          <p class="text-[14px] font-medium text-highlighted">
            Google Calendar is not available yet
          </p>
          <p class="mt-1 text-[13px] leading-relaxed text-muted">
            Add the Google OAuth credentials and callback URL to the deployment environment to enable this integration.
          </p>
        </div>
      </div>

      <div
        v-else-if="!connection?.connected"
        class="divide-y divide-default"
      >
        <div
          v-if="connection?.status === 'needs_reauthorization'"
          class="flex items-start gap-3 bg-warning/5 px-6 py-4 text-[13px] text-warning sm:px-7"
        >
          <UIcon
            name="i-lucide-triangle-alert"
            class="mt-0.5 size-4 shrink-0"
          />
          Google access has expired. Reconnect before guests can see bookable times again.
        </div>
        <div class="grid gap-px bg-border sm:grid-cols-3">
          <div
            v-for="benefit in [
              ['i-lucide-shield-check', 'Avoid conflicts', 'Schedra checks selected calendars before showing a time.'],
              ['i-lucide-calendar-plus', 'Create events', 'Confirmed bookings appear on the calendar you choose.'],
              ['i-lucide-refresh-cw', 'Stay in sync', 'Reschedules and cancellations update automatically.']
            ]"
            :key="benefit[1]"
            class="bg-default px-6 py-6"
          >
            <UIcon
              :name="benefit[0]"
              class="size-4 text-primary"
            />
            <h3 class="mt-3 text-[13px] font-semibold text-highlighted">
              {{ benefit[1] }}
            </h3>
            <p class="mt-1 text-[12px] leading-relaxed text-muted">
              {{ benefit[2] }}
            </p>
          </div>
        </div>
      </div>

      <IntegrationPreferencesSkeleton
        v-else-if="loadingCalendars && !calendars.length"
      />

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
        <AsyncErrorState
          v-if="calendarFailure"
          compact
          class="bg-error/5"
          title="Could not refresh your calendars"
          description="The last loaded calendar preferences are still shown below."
          :retrying="loadingCalendars"
          @retry="loadCalendars(true)"
        />
        <div
          v-else-if="loadingCalendars"
          class="flex items-center gap-2 bg-muted/50 px-5 py-2 text-[11px] text-muted sm:px-7"
          role="status"
          aria-live="polite"
        >
          <UIcon
            name="i-lucide-loader-circle"
            class="size-3.5 animate-spin text-primary"
          />
          Refreshing calendars…
        </div>
        <div
          v-else-if="connection.lastError && !pageError"
          class="flex items-start gap-3 bg-warning/5 px-5 py-4 text-[13px] text-warning sm:px-7"
        >
          <UIcon
            name="i-lucide-triangle-alert"
            class="mt-0.5 size-4 shrink-0"
          />
          {{ connection.lastError }} Review the calendars below and save your preferences if needed.
        </div>
        <div class="grid grid-cols-[minmax(0,1fr)] gap-6 px-5 py-6 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] sm:px-7">
          <div class="min-w-0">
            <h3 class="text-[14px] font-semibold text-highlighted">
              Calendars that block booking times
            </h3>
            <p class="mt-1 text-[12px] leading-relaxed text-muted">
              Select every calendar where an existing busy event means a guest should not be able to book you. Some subscription calendars, such as holidays and week numbers, do not provide busy times and should stay unchecked.
            </p>
          </div>
          <div class="min-w-0">
            <div class="overflow-hidden rounded-lg border border-default">
              <label
                v-for="calendar in conflictCalendars"
                :key="calendar.id"
                class="flex cursor-pointer items-center gap-3 border-b border-default px-4 py-3 last:border-b-0 hover:bg-muted"
              >
                <UCheckbox
                  :model-value="selectedConflictIds.includes(calendar.id)"
                  :aria-label="`Check ${calendar.summary} for conflicts`"
                  @update:model-value="toggleConflict(calendar.id, Boolean($event))"
                />
                <span
                  class="size-2.5 shrink-0 rounded-full"
                  :style="{ backgroundColor: calendar.unavailable ? '#737373' : (calendar.backgroundColor || '#4285F4') }"
                />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[13px] font-medium text-highlighted">{{ calendar.summary }}</span>
                  <span class="mt-0.5 block truncate text-[11px] text-dimmed">{{ calendarRelationship(calendar) }}</span>
                </span>
                <span
                  v-if="calendar.primary"
                  class="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                >Recommended</span>
                <span
                  v-else-if="calendar.unavailable"
                  class="text-[10px] text-warning"
                >Remove</span>
              </label>
            </div>
            <p
              v-if="!selectedConflictIds.length"
              class="mt-2 text-[12px] text-error"
            >
              Choose at least one calendar so Schedra can prevent conflicts.
            </p>
            <p
              v-else
              class="mt-2 text-[11px] text-dimmed"
            >
              {{ selectedConflictIds.length }} {{ selectedConflictIds.length === 1 ? 'calendar' : 'calendars' }} will be checked before showing available times.
            </p>
          </div>
        </div>

        <div class="grid grid-cols-[minmax(0,1fr)] gap-6 px-5 py-6 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] sm:px-7">
          <div class="min-w-0">
            <h3 class="text-[14px] font-semibold text-highlighted">
              Calendar for new bookings
            </h3>
            <p class="mt-1 text-[12px] leading-relaxed text-muted">
              Choose the one calendar where Schedra should create booking events. Reschedules and cancellations will update the same event automatically.
            </p>
          </div>
          <div class="min-w-0">
            <USelectMenu
              v-model="writeCalendarId"
              :items="writableCalendars"
              value-key="value"
              label-key="label"
              icon="i-lucide-calendar-days"
              placeholder="Choose a calendar"
              class="min-h-11 w-full sm:min-h-8"
            />
            <p
              v-if="!writableCalendars.length || writeCalendarMissing"
              class="mt-2 text-[12px] text-error"
            >
              {{ writeCalendarMissing ? 'The previously selected calendar is unavailable. Choose another.' : 'This Google account has no calendar Schedra is allowed to edit.' }}
            </p>
          </div>
        </div>

        <div
          v-if="pageError"
          class="mx-5 mb-5 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-[13px] text-error sm:mx-7"
          role="alert"
        >
          {{ pageError }}
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 bg-muted px-5 py-4 sm:px-7">
          <p class="flex items-center gap-2 text-[12px] text-muted">
            <UIcon
              name="i-lucide-lock-keyhole"
              class="size-3.5"
            />
            Calendar access is encrypted and can be revoked anytime.
          </p>
          <div>
            <UButton
              :loading="saving"
              :disabled="!dirty || !selectedConflictIds.length || !writeCalendarId || writeCalendarMissing"
              class="min-h-11 sm:min-h-9"
              @click="saveCalendars"
            >
              Save preferences
            </UButton>
          </div>
        </div>
      </div>
    </section>

    <section class="overflow-hidden rounded-xl border border-default bg-default">
      <div class="flex flex-col gap-5 border-b border-default px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div class="flex min-w-0 items-center gap-4">
          <span class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[#2D8CFF] text-white shadow-sm">
            <UIcon
              name="i-simple-icons-zoom"
              class="size-6"
            />
          </span>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-[16px] font-semibold text-highlighted">
                Zoom
              </h2>
              <span
                v-if="zoomConnection?.connected"
                class="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success"
              ><span class="size-1.5 rounded-full bg-success" />Connected</span>
              <span
                v-else-if="zoomConnection?.status === 'needs_reauthorization'"
                class="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning"
              ><span class="size-1.5 rounded-full bg-warning" />Needs attention</span>
            </div>
            <p class="mt-1 truncate text-[13px] text-muted">
              {{ zoomConnection?.accountLabel || 'Create a unique Zoom meeting for every confirmed booking.' }}
            </p>
          </div>
        </div>

        <UButton
          v-if="zoomConnection?.connected"
          color="error"
          variant="outline"
          size="sm"
          icon="i-lucide-unplug"
          class="min-h-11 font-medium sm:min-h-8"
          @click="zoomDisconnectOpen = true"
        >
          Disconnect
        </UButton>
        <UButton
          v-else-if="zoomConnection?.configured"
          to="/api/integrations/zoom/connect"
          external
          icon="i-lucide-link"
          class="min-h-11 sm:min-h-9"
        >
          {{ zoomConnection?.status === 'needs_reauthorization' ? 'Reconnect' : 'Connect' }}
        </UButton>
      </div>

      <IntegrationPreferencesSkeleton v-if="zoomStatus === 'pending'" />
      <AsyncErrorState
        v-else-if="zoomFailure"
        compact
        title="Could not load Zoom"
        description="Check your connection and try loading the Zoom integration again."
        :retrying="zoomRetrying"
        @retry="refreshZoomConnection"
      />
      <div
        v-else-if="!zoomConnection?.configured"
        class="flex items-start gap-3 px-6 py-6 sm:px-7"
      >
        <UIcon
          name="i-lucide-info"
          class="mt-0.5 size-4 shrink-0 text-muted"
        />
        <div>
          <p class="text-[14px] font-medium text-highlighted">
            Zoom is not available yet
          </p>
          <p class="mt-1 text-[13px] leading-relaxed text-muted">
            Add the Zoom OAuth credentials and callback URL to this deployment to enable automatic meeting links.
          </p>
        </div>
      </div>
      <div
        v-else-if="zoomConnection?.connected"
        class="grid gap-px bg-border sm:grid-cols-3"
      >
        <div
          v-for="benefit in [
            ['i-lucide-video', 'Unique meeting links', 'Every confirmed booking receives its own protected Zoom room.'],
            ['i-lucide-calendar-clock', 'Reschedules stay current', 'Changing a booking updates the existing Zoom meeting automatically.'],
            ['i-lucide-calendar-x', 'Cancellations clean up', 'Cancelling a booking removes its Zoom meeting while access is connected.']
          ]"
          :key="benefit[1]"
          class="bg-default px-6 py-6"
        >
          <UIcon
            :name="benefit[0]"
            class="size-4 text-primary"
          />
          <h3 class="mt-3 text-[13px] font-semibold text-highlighted">
            {{ benefit[1] }}
          </h3>
          <p class="mt-1 text-[12px] leading-relaxed text-muted">
            {{ benefit[2] }}
          </p>
        </div>
      </div>
      <div
        v-else
        class="divide-y divide-default"
      >
        <div
          v-if="zoomConnection?.status === 'needs_reauthorization'"
          class="flex items-start gap-3 bg-warning/5 px-6 py-4 text-[13px] text-warning sm:px-7"
        >
          <UIcon
            name="i-lucide-triangle-alert"
            class="mt-0.5 size-4 shrink-0"
          />
          Zoom access has expired. Reconnect before using Zoom on new bookings.
        </div>
        <div class="px-6 py-6 sm:px-7">
          <p class="max-w-2xl text-[13px] leading-relaxed text-muted">
            Once connected, choose Zoom when creating an event type. Schedra creates the meeting only after a booking is confirmed and keeps it synchronized through reschedules and cancellations.
          </p>
        </div>
      </div>
      <div
        v-if="zoomPageError"
        class="border-t border-error/30 bg-error/10 px-6 py-3 text-[13px] text-error sm:px-7"
        role="alert"
      >
        {{ zoomPageError }}
      </div>
    </section>

    <section class="rounded-xl border border-dashed border-default px-6 py-7 text-center">
      <span class="mx-auto flex size-10 items-center justify-center rounded-xl bg-muted text-muted">
        <UIcon
          name="i-lucide-blocks"
          class="size-4.5"
        />
      </span>
      <h2 class="mt-4 text-[14px] font-semibold text-highlighted">
        More integrations are coming
      </h2>
      <p class="mx-auto mt-1 max-w-md text-[12px] leading-relaxed text-muted">
        More calendars, video providers and automation tools will live here without cluttering your account settings.
      </p>
    </section>

    <UModal
      v-model:open="disconnectOpen"
      title="Disconnect Google Calendar?"
      description="Schedra will stop checking Google for conflicts and stop syncing new booking changes."
    >
      <template #body>
        <p class="text-[14px] leading-relaxed text-muted">
          Events already created in Google Calendar will remain there. You can remove them manually if needed.
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

    <UModal
      v-model:open="zoomDisconnectOpen"
      title="Disconnect Zoom?"
      description="Schedra will stop creating and updating Zoom meetings for future booking changes."
    >
      <template #body>
        <p class="text-[14px] leading-relaxed text-muted">
          Zoom meetings already created will remain in your Zoom account. Existing event types using Zoom must be changed before they can accept new bookings.
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="zoomDisconnecting"
            @click="zoomDisconnectOpen = false"
          >
            Keep connected
          </UButton>
          <UButton
            color="error"
            :loading="zoomDisconnecting"
            @click="disconnectZoom"
          >
            Disconnect
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
