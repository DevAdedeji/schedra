<script setup lang="ts">
import {
  apiErrorMessage,
  integrationHealthApi,
  zoomApi,
  type IntegrationSyncHealth,
  type VideoConferenceConnection
} from '~/services/schedra-api'

definePageMeta({ layout: 'app', middleware: 'auth' })
useSeoMeta({ title: 'Integrations', robots: 'noindex, nofollow' })

const route = useRoute()
const router = useRouter()
const feedback = useFeedback()
const callback = reactive({
  google: typeof route.query.calendar === 'string' ? route.query.calendar : '',
  microsoft: typeof route.query.microsoft === 'string' ? route.query.microsoft : '',
  zoom: typeof route.query.zoom === 'string' ? route.query.zoom : ''
})
const calendarRefreshSignal = ref(0)
const { data: health, refresh: refreshHealth, status: healthStatus, error: healthFailure } = await useLazyFetch<IntegrationSyncHealth>(integrationHealthApi.endpoint)
const { data: zoomConnection, refresh: refreshZoomConnection, status: zoomStatus, error: zoomFailure } = await useLazyFetch<VideoConferenceConnection>(zoomApi.connectionEndpoint)
const retryingSyncs = ref(false)
const zoomManageOpen = ref(false)
const zoomDisconnectOpen = ref(false)
const zoomDisconnecting = ref(false)
const zoomChecking = ref(false)
const zoomPageError = ref('')

const callbackNotice = computed(() => {
  const result = [
    { name: 'Google Calendar', value: callback.google },
    { name: 'Microsoft Calendar', value: callback.microsoft },
    { name: 'Zoom', value: callback.zoom }
  ].find(item => item.value)
  if (!result) return null
  if (result.value === 'connected') return { tone: 'success', text: `${result.name} is connected and ready to configure.` }
  if (result.value === 'setup-incomplete') {
    return {
      tone: 'warning',
      text: `${result.name} is connected, but its calendars could not be loaded yet. Open Manage settings and try again.`
    }
  }
  if (result.value === 'invalid-request') return { tone: 'error', text: `That ${result.name} connection request expired. Please start again.` }
  return { tone: 'error', text: `${result.name} could not be connected. Check its credentials, scopes and callback URL, then try again.` }
})

const healthProviderName = computed(() => ({
  google: 'Google Calendar', microsoft: 'Microsoft Calendar', zoom: 'Zoom'
})[health.value?.failureProvider ?? 'google'])

onMounted(() => {
  if (!callback.google && !callback.microsoft && !callback.zoom) return
  const query = { ...route.query }
  delete query.calendar
  delete query.microsoft
  delete query.zoom
  void router.replace({ path: route.path, query })
})

async function calendarSaved() {
  calendarRefreshSignal.value += 1
  await refreshHealth()
}

async function retrySyncs() {
  retryingSyncs.value = true
  try {
    const result = await integrationHealthApi.retry(health.value?.failureProvider ?? undefined)
    await refreshHealth()
    feedback.success({ title: result.retried ? `${result.retried} booking ${result.retried === 1 ? 'update' : 'updates'} queued again` : 'No failed updates needed retrying' })
  } catch (failure) {
    feedback.error({ title: apiErrorMessage(failure, 'Could not retry booking updates just now.') })
  } finally {
    retryingSyncs.value = false
  }
}

async function checkZoom() {
  if (!zoomConnection.value?.connected || zoomChecking.value) return
  zoomChecking.value = true
  zoomPageError.value = ''
  try {
    zoomConnection.value = await zoomApi.check()
  } catch (failure) {
    zoomPageError.value = apiErrorMessage(failure, 'Zoom could not be checked just now.')
    await refreshZoomConnection()
  } finally {
    zoomChecking.value = false
  }
}

async function openZoom() {
  zoomManageOpen.value = true
  await checkZoom()
}

async function disconnectZoom() {
  zoomDisconnecting.value = true
  zoomPageError.value = ''
  try {
    await zoomApi.disconnect()
    zoomDisconnectOpen.value = false
    zoomManageOpen.value = false
    await Promise.all([refreshZoomConnection(), refreshHealth()])
    feedback.success({ title: 'Zoom disconnected' })
  } catch (failure) {
    zoomPageError.value = apiErrorMessage(failure, 'Could not disconnect Zoom just now.')
  } finally {
    zoomDisconnecting.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="Integrations"
      description="Connect the tools that keep your schedule accurate and your meetings moving."
    />

    <div
      v-if="callbackNotice"
      class="flex items-start gap-3 rounded-xl border px-4 py-3 text-[12px]"
      :class="callbackNotice.tone === 'success'
        ? 'border-success/25 bg-success/10 text-success'
        : callbackNotice.tone === 'warning'
          ? 'border-warning/25 bg-warning/10 text-warning'
          : 'border-error/25 bg-error/10 text-error'"
      role="status"
    >
      <UIcon
        :name="callbackNotice.tone === 'success' ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'"
        class="mt-0.5 size-4 shrink-0"
      />{{ callbackNotice.text }}
    </div>

    <div
      v-if="health?.failed"
      class="flex flex-col gap-3 rounded-xl border border-error/25 bg-error/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      role="alert"
    >
      <div class="flex min-w-0 items-start gap-3">
        <UIcon
          name="i-lucide-cloud-alert"
          class="mt-0.5 size-4 shrink-0 text-error"
        />
        <div class="min-w-0">
          <p class="text-[12px] font-semibold text-error">
            {{ health.failed }} booking {{ health.failed === 1 ? 'update needs' : 'updates need' }} attention
          </p>
          <p class="mt-0.5 truncate text-[11px] text-muted">
            {{ healthProviderName }} did not receive the latest change. {{ health.lastError }}
          </p>
        </div>
      </div>
      <UButton
        size="xs"
        color="error"
        variant="outline"
        icon="i-lucide-refresh-cw"
        :loading="retryingSyncs"
        @click="retrySyncs"
      >
        Retry now
      </UButton>
    </div>
    <div
      v-else-if="health && (health.pending || health.processing)"
      class="surface-secondary flex items-center gap-3 rounded-xl border border-default px-4 py-3 text-[11px] text-muted"
      role="status"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-4 animate-spin text-primary"
      />Keeping {{ health.pending + health.processing }} booking {{ health.pending + health.processing === 1 ? 'change' : 'changes' }} in sync.
    </div>
    <AsyncErrorState
      v-else-if="healthFailure"
      compact
      title="Could not check integration health"
      description="Your integrations can still be managed below. Try the health check again."
      :retrying="healthStatus === 'pending'"
      @retry="refreshHealth"
    />

    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <CalendarIntegrationCard
        provider="google-calendar"
        name="Google Calendar"
        icon="i-simple-icons-googlecalendar"
        icon-class="text-[#4285F4]"
        description="Prevent double-booking and keep meeting events synchronized."
        :refresh-signal="calendarRefreshSignal"
        @saved="calendarSaved"
      />
      <CalendarIntegrationCard
        provider="microsoft-calendar"
        name="Microsoft Calendar"
        icon="i-simple-icons-microsoftoutlook"
        icon-class="text-[#0078D4]"
        description="Use Outlook calendars for conflict checks and booking events."
        :refresh-signal="calendarRefreshSignal"
        @saved="calendarSaved"
      />

      <IntegrationCardSkeleton v-if="zoomStatus === 'pending' && !zoomConnection" />
      <section
        v-else-if="zoomFailure && !zoomConnection"
        class="flex min-h-56 flex-col items-center justify-center rounded-xl border border-error/20 bg-default p-5 text-center"
      >
        <UIcon
          name="i-lucide-cloud-alert"
          class="size-5 text-error"
        />
        <h2 class="mt-3 text-[14px] font-semibold text-highlighted">
          Could not check Zoom
        </h2>
        <p class="mt-1 text-[12px] text-muted">
          Try loading its connection status again.
        </p>
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-refresh-cw"
          class="mt-4"
          @click="() => refreshZoomConnection()"
        >
          Try again
        </UButton>
      </section>
      <section
        v-else
        class="flex min-h-56 flex-col rounded-xl border border-default bg-default p-5"
      >
        <div class="flex items-start justify-between gap-3">
          <span class="flex size-11 items-center justify-center rounded-xl bg-[#2D8CFF] text-white shadow-sm"><UIcon
            name="i-simple-icons-zoom"
            class="size-5.5"
          /></span>
          <span
            v-if="zoomConnection?.connected"
            class="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success"
          ><span class="size-1.5 rounded-full bg-success" />Connected</span>
          <span
            v-else-if="zoomConnection?.status === 'needs_reauthorization'"
            class="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning"
          ><span class="size-1.5 rounded-full bg-warning" />Needs attention</span>
        </div>
        <h2 class="mt-4 text-[15px] font-semibold text-highlighted">
          Zoom
        </h2>
        <p class="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted">
          {{ zoomConnection?.accountLabel || 'Create a unique Zoom meeting for every confirmed booking.' }}
        </p>
        <div class="mt-auto pt-5">
          <UButton
            v-if="zoomConnection?.connected"
            color="neutral"
            variant="soft"
            icon="i-lucide-settings-2"
            trailing-icon="i-lucide-chevron-right"
            block
            class="min-h-10"
            @click="openZoom"
          >
            Manage settings
          </UButton>
          <UButton
            v-else-if="zoomConnection?.configured"
            to="/api/integrations/zoom/connect"
            external
            icon="i-lucide-link"
            block
            class="min-h-10"
          >
            {{ zoomConnection?.status === 'needs_reauthorization' ? 'Reconnect' : 'Connect' }}
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
      </section>
    </div>

    <section class="rounded-xl border border-dashed border-default px-6 py-6 text-center">
      <UIcon
        name="i-lucide-blocks"
        class="mx-auto size-4 text-muted"
      />
      <h2 class="mt-3 text-[13px] font-semibold text-highlighted">
        More integrations are coming
      </h2>
      <p class="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-muted">
        Additional calendars, video providers and automation tools will appear here without cluttering settings.
      </p>
    </section>

    <UModal
      v-model:open="zoomManageOpen"
      title="Zoom"
      description="Create and maintain a unique Zoom meeting for every confirmed booking."
      :ui="{ content: 'w-full max-w-3xl', body: 'p-0 sm:p-0', footer: 'border-t border-default px-5 py-4 sm:px-6' }"
    >
      <template #body>
        <IntegrationPreferencesSkeleton v-if="zoomStatus === 'pending'" />
        <AsyncErrorState
          v-else-if="zoomFailure"
          compact
          title="Could not load Zoom"
          description="Check your connection and try again."
          :retrying="false"
          @retry="refreshZoomConnection"
        />
        <template v-else>
          <div class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div class="flex min-w-0 items-center gap-3">
              <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success"><UIcon
                name="i-lucide-circle-check"
                class="size-4"
              /></span>
              <div class="min-w-0">
                <p class="text-[12px] font-medium text-highlighted">
                  Connected account
                </p><p class="truncate text-[11px] text-muted">
                  {{ zoomConnection?.accountLabel }}
                </p>
              </div>
            </div>
            <UButton
              color="error"
              variant="soft"
              icon="i-lucide-unplug"
              @click="zoomDisconnectOpen = true"
            >
              Disconnect integration
            </UButton>
          </div>
          <div class="grid gap-px border-t border-default bg-border sm:grid-cols-3">
            <div
              v-for="benefit in [
                ['i-lucide-video', 'Unique links', 'Every booking receives its own protected Zoom room.'],
                ['i-lucide-calendar-clock', 'Reschedules', 'Booking changes update the existing meeting.'],
                ['i-lucide-calendar-x', 'Cancellations', 'Cancelled bookings remove their Zoom meeting.']
              ]"
              :key="benefit[1]"
              class="bg-default px-5 py-6"
            >
              <UIcon
                :name="benefit[0]"
                class="size-4 text-primary"
              /><p class="mt-2 text-[12px] font-semibold text-highlighted">
                {{ benefit[1] }}
              </p><p class="mt-1 text-[11px] leading-relaxed text-muted">
                {{ benefit[2] }}
              </p>
            </div>
          </div>
          <div
            v-if="zoomChecking"
            class="surface-secondary flex items-center gap-2 border-t border-default px-5 py-3 text-[11px] text-muted"
          >
            <UIcon
              name="i-lucide-loader-circle"
              class="size-3.5 animate-spin text-primary"
            />Checking Zoom access…
          </div>
          <div
            v-if="zoomPageError"
            class="flex items-center justify-between gap-3 border-t border-error/25 bg-error/10 px-5 py-3 text-[11px] text-error"
            role="alert"
          >
            <span>{{ zoomPageError }}</span><UButton
              color="error"
              variant="ghost"
              size="xs"
              @click="checkZoom"
            >
              Try again
            </UButton>
          </div>
        </template>
      </template>
      <template #footer>
        <div class="flex w-full items-center gap-3">
          <UButton
            color="neutral"
            variant="soft"
            @click="zoomManageOpen = false"
          >
            Close
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
        <p class="text-[13px] leading-relaxed text-muted">
          Meetings already created remain in your Zoom account. Change event types using Zoom before accepting new bookings.
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
          </UButton><UButton
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
