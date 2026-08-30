<script setup lang="ts">
import { apiErrorMessage, type CalendarIntegrationProvider } from '~/services/schedra-api'

const props = defineProps<{
  provider: CalendarIntegrationProvider
  name: string
  icon: string
  iconClass: string
  description: string
  refreshSignal?: number
  credentialConnection?: boolean
}>()

const emit = defineEmits<{ saved: [] }>()
const {
  api, connection, refreshConnection, status, connectionFailure, settingsOpen,
  disconnectOpen, calendars, selectedConflictIds, writeCalendarId, defaultForBookings,
  loadingCalendars, calendarFailure, pageError, saving, disconnecting, isGoogle,
  writableCalendars, conflictCalendars, dirty, writeCalendarMissing,
  relationship, toggleConflict, loadCalendars, retryConnection, save, disconnect
} = await useCalendarIntegration({
  provider: props.provider,
  name: () => props.name,
  refreshSignal: () => props.refreshSignal,
  onSaved: () => emit('saved')
})
const credentialOpen = ref(false)
const credentialForm = reactive({ username: '', password: '' })
const credentialError = ref('')
const connecting = ref(false)
const canConnect = computed(() => credentialForm.username.trim().includes('@') && credentialForm.password.trim().length >= 10)

watch(credentialOpen, (open) => {
  if (open) return
  credentialForm.password = ''
  credentialError.value = ''
})

async function connectWithCredentials() {
  if (!props.credentialConnection || !canConnect.value || connecting.value) return
  connecting.value = true
  credentialError.value = ''
  try {
    await api.connect({
      username: credentialForm.username.trim(),
      password: credentialForm.password.trim()
    })
    credentialForm.password = ''
    credentialOpen.value = false
    await refreshConnection()
    await loadCalendars(true)
    settingsOpen.value = true
    emit('saved')
    useFeedback().success({ title: `${props.name} connected` })
  } catch (failure) {
    credentialError.value = apiErrorMessage(failure, `Could not connect ${props.name} just now.`)
  } finally {
    connecting.value = false
  }
}

// Something has to be the default, so the switch only turns on: you move it by
// turning the other provider on.
const alreadyDefault = computed(() => Boolean(connection.value?.defaultForBookings))
const defaultDescription = computed(() => (alreadyDefault.value
  ? 'Zoom, phone, in-person and custom meetings are created in this account. To move the default, turn this on for your other calendar.'
  : 'Turn this on to create Zoom, phone, in-person and custom meetings here instead of your other calendar.'))
</script>

<template>
  <IntegrationCardSkeleton v-if="status === 'pending' && !connection" />
  <section
    v-else-if="connectionFailure && !connection"
    class="flex min-h-56 flex-col items-center justify-center rounded-xl border border-error/20 bg-default p-5 text-center"
  >
    <UIcon
      name="i-lucide-cloud-alert"
      class="size-5 text-error"
    />
    <h2 class="mt-3 text-[15px] font-semibold text-highlighted">
      Could not check {{ name }}
    </h2>
    <p class="mt-1 text-[13px] text-muted">
      Try loading its connection status again.
    </p>
    <UButton
      color="neutral"
      variant="outline"
      size="sm"
      icon="i-lucide-refresh-cw"
      class="mt-4"
      @click="retryConnection"
    >
      Try again
    </UButton>
  </section>
  <section
    v-else
    class="flex min-h-56 flex-col rounded-xl border border-default bg-default p-5"
  >
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
        class="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2 py-0.5 text-[12px] font-medium text-warning"
      ><span class="size-1.5 rounded-full bg-warning" />Setup required</span>
      <span
        v-else-if="connection?.connected"
        class="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-[12px] font-medium text-success"
      ><span class="size-1.5 rounded-full bg-success" />{{ connection.defaultForBookings ? 'Default calendar' : 'Connected' }}</span>
      <span
        v-else-if="connection?.status === 'needs_reauthorization'"
        class="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2 py-0.5 text-[12px] font-medium text-warning"
      ><span class="size-1.5 rounded-full bg-warning" />Needs attention</span>
    </div>
    <h2 class="mt-4 text-[17px] font-semibold text-highlighted">
      {{ name }}
    </h2>
    <p class="mt-1 line-clamp-2 text-[14px] leading-relaxed text-muted">
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
        v-else-if="connection?.configured && credentialConnection"
        icon="i-lucide-link"
        block
        class="min-h-10"
        @click="credentialOpen = true"
      >
        {{ connection?.status === 'needs_reauthorization' ? 'Reconnect' : 'Connect' }}
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
      :ui="{ content: 'w-full max-w-3xl', body: 'p-0 sm:p-0', footer: 'border-t border-default px-5 py-4 sm:px-6' }"
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
          <div>
            <div class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div class="flex min-w-0 items-center gap-3">
                <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success"><UIcon
                  name="i-lucide-circle-check"
                  class="size-4"
                /></span>
                <div class="min-w-0">
                  <p class="text-[14px] font-medium text-highlighted">
                    Connected account
                  </p>
                  <p class="truncate text-[13px] text-muted">
                    {{ connection?.accountLabel }}
                  </p>
                </div>
              </div>
              <UButton
                color="error"
                variant="soft"
                size="sm"
                icon="i-lucide-unplug"
                class="shrink-0 self-start sm:self-auto"
                @click="disconnectOpen = true"
              >
                Disconnect
              </UButton>
            </div>

            <!-- Which provider wins is an account-level choice, so it belongs
                 with the account rather than under a per-calendar control. -->
            <label
              class="flex items-start justify-between gap-4 border-t border-default px-5 py-4 transition-colors sm:px-6"
              :class="alreadyDefault ? 'cursor-default' : 'cursor-pointer hover:bg-elevated/50'"
            >
              <span class="min-w-0">
                <span class="block text-[14px] font-medium text-highlighted">Default for bookings</span>
                <span class="mt-0.5 block max-w-xl text-[13px] leading-relaxed text-muted">{{ defaultDescription }}</span>
                <span class="mt-1 block max-w-xl text-[13px] leading-relaxed text-dimmed">
                  Google Meet and Microsoft Teams always use their own provider.
                </span>
              </span>
              <USwitch
                v-model="defaultForBookings"
                :disabled="alreadyDefault"
                class="mt-0.5 shrink-0"
                aria-label="Use this account for meetings without their own provider"
              />
            </label>
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
            class="flex items-start gap-3 bg-warning/5 px-5 py-3 text-[13px] text-warning sm:px-6"
          >
            <UIcon
              name="i-lucide-triangle-alert"
              class="mt-0.5 size-4 shrink-0"
            />{{ connection.lastError }}
          </div>

          <section class="px-5 py-5 sm:px-6">
            <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 class="text-[15px] font-semibold text-highlighted">
                Calendars that block booking times
              </h3>
              <p
                class="text-[13px]"
                :class="selectedConflictIds.length ? 'text-dimmed' : 'text-error'"
              >
                {{ selectedConflictIds.length
                  ? `${selectedConflictIds.length} of ${conflictCalendars.length} selected`
                  : 'Choose at least one' }}
              </p>
            </div>
            <p class="mt-1 max-w-2xl text-[14px] leading-relaxed text-muted">
              A busy event on a selected calendar hides that time from guests. Holiday and
              week-number calendars usually stay unchecked.
            </p>

            <div class="mt-3 max-h-72 overflow-y-auto rounded-xl border border-default">
              <label
                v-for="calendar in conflictCalendars"
                :key="calendar.id"
                class="flex cursor-pointer items-center gap-3 border-b border-default px-3.5 py-3 transition-colors last:border-b-0"
                :class="selectedConflictIds.includes(calendar.id) ? 'bg-primary/5' : 'hover:bg-elevated/50'"
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
                  <span class="block truncate text-[15px] font-medium text-highlighted">{{ calendar.summary }}</span>
                  <span class="mt-0.5 block truncate text-[13px] text-dimmed">{{ relationship(calendar) }}</span>
                </span>
                <span
                  v-if="calendar.primary"
                  class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[12px] font-medium text-primary"
                >Recommended</span>
              </label>
            </div>
          </section>

          <section class="px-5 py-5 sm:px-6">
            <h3 class="text-[15px] font-semibold text-highlighted">
              Calendar for new bookings
            </h3>
            <p class="mt-1 max-w-2xl text-[14px] leading-relaxed text-muted">
              Every booking this account handles lands in the calendar you choose here.
            </p>

            <USelectMenu
              v-model="writeCalendarId"
              :items="writableCalendars"
              value-key="value"
              label-key="label"
              icon="i-lucide-calendar-days"
              placeholder="Choose a calendar"
              class="mt-3 w-full sm:max-w-sm"
            />
            <p
              v-if="!writableCalendars.length || writeCalendarMissing"
              class="mt-2 text-[13px] text-error"
            >
              {{ writeCalendarMissing ? 'The previous destination is unavailable. Choose another.' : `This ${name} account has no calendar Schedra can edit.` }}
            </p>
          </section>
          <div
            v-if="pageError"
            class="bg-error/10 px-5 py-3 text-[13px] text-error"
            role="alert"
          >
            {{ pageError }}
          </div>
        </div>
      </template>
      <template #footer>
        <ModalFooter :hint="dirty ? 'You have unsaved changes' : undefined">
          <template #cancel>
            <UButton
              color="neutral"
              variant="soft"
              :disabled="saving"
              @click="settingsOpen = false"
            >
              Close
            </UButton>
          </template>
          <template #actions>
            <UButton
              :loading="saving"
              :disabled="(!dirty && !connection?.setupRequired) || !selectedConflictIds.length || !writeCalendarId || writeCalendarMissing"
              @click="save"
            >
              Save preferences
            </UButton>
          </template>
        </ModalFooter>
      </template>
    </UModal>

    <UModal
      v-if="credentialConnection"
      v-model:open="credentialOpen"
      title="Connect Apple Calendar"
      description="Use a separate app-specific password so Schedra never receives your main Apple Account password."
      :ui="{ content: 'w-[calc(100%-1.5rem)] max-w-lg' }"
    >
      <template #body>
        <form
          id="apple-calendar-connect-form"
          class="space-y-4"
          @submit.prevent="connectWithCredentials"
        >
          <UFormField
            label="Apple Account email"
            required
          >
            <UInput
              v-model="credentialForm.username"
              type="email"
              inputmode="email"
              autocomplete="username"
              placeholder="you@icloud.com"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="App-specific password"
            required
            help="Create one under Sign-In and Security → App-Specific Passwords on account.apple.com. Two-factor authentication must be enabled."
          >
            <UInput
              v-model="credentialForm.password"
              type="password"
              autocomplete="off"
              placeholder="xxxx-xxxx-xxxx-xxxx"
              class="w-full"
            />
          </UFormField>
          <div class="rounded-xl border border-default bg-elevated/50 px-4 py-3 text-[13px] leading-relaxed text-muted">
            Do not enter your normal Apple Account password. You can revoke this password from Apple at any time.
            <a
              href="https://support.apple.com/102654"
              target="_blank"
              rel="noopener noreferrer"
              class="ml-1 font-medium text-primary hover:underline"
            >Apple’s instructions</a>
          </div>
          <p
            v-if="credentialError"
            class="text-[13px] text-error"
            role="alert"
          >
            {{ credentialError }}
          </p>
        </form>
      </template>
      <template #footer>
        <ModalFooter>
          <template #cancel>
            <UButton
              color="neutral"
              variant="soft"
              :disabled="connecting"
              @click="credentialOpen = false"
            >
              Cancel
            </UButton>
          </template>
          <template #actions>
            <UButton
              type="submit"
              form="apple-calendar-connect-form"
              :loading="connecting"
              :disabled="!canConnect"
            >
              Connect securely
            </UButton>
          </template>
        </ModalFooter>
      </template>
    </UModal>

    <UModal
      v-model:open="disconnectOpen"
      :title="`Disconnect ${name}?`"
      description="Schedra will stop checking this provider and syncing booking changes to it."
    >
      <template #body>
        <p class="text-[14px] leading-relaxed text-muted">
          Previously created events remain in the provider and can be removed there manually.
        </p>
      </template>
      <template #footer>
        <ModalFooter>
          <template #cancel>
            <UButton
              color="neutral"
              variant="soft"
              :disabled="disconnecting"
              @click="disconnectOpen = false"
            >
              Keep connected
            </UButton>
          </template>
          <template #actions>
            <UButton
              color="error"
              :loading="disconnecting"
              @click="disconnect"
            >
              Disconnect
            </UButton>
          </template>
        </ModalFooter>
      </template>
    </UModal>
  </section>
</template>
