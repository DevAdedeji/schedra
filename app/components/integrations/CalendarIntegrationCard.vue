<script setup lang="ts">
import type { CalendarIntegrationProvider } from '~/services/schedra-api'

const props = defineProps<{
  provider: CalendarIntegrationProvider
  name: string
  icon: string
  iconClass: string
  description: string
  refreshSignal?: number
}>()

const emit = defineEmits<{ saved: [] }>()
const {
  api, connection, status, connectionFailure, settingsOpen,
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
              variant="ghost"
              size="sm"
              icon="i-lucide-unplug"
              class="shrink-0 self-start sm:self-auto"
              @click="disconnectOpen = true"
            >
              Disconnect
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
              Where this provider creates booking events. Google Meet and Microsoft Teams always
              use their matching provider.
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

            <label class="mt-3 flex max-w-2xl cursor-pointer items-start gap-2.5 rounded-xl border border-default px-3.5 py-3 transition-colors hover:bg-elevated/50">
              <UCheckbox
                v-model="defaultForBookings"
                :disabled="Boolean(connection?.defaultForBookings)"
                aria-label="Use this provider as the default calendar"
              />
              <span>
                <span class="block text-[14px] font-medium text-highlighted">Use as my default calendar</span>
                <span class="mt-0.5 block text-[13px] leading-relaxed text-muted">Used for Zoom, phone, in-person and custom meeting locations. Choose the other provider here to switch the default.</span>
              </span>
            </label>
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
