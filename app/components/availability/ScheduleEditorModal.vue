<script setup lang="ts">
import type { ScheduleRecord } from '~/types/schedule'

const props = defineProps<{ open: boolean, schedule?: ScheduleRecord | null }>()
const emit = defineEmits<{ 'update:open': [value: boolean], 'saved': [id: string] }>()

const isOpen = computed({ get: () => props.open, set: value => emit('update:open', value) })
const {
  zones, name, timeZone, isDefault, rows, overrides, view, saving, error,
  enabledCount, invalid, dirty, viewOptions, overrideOpen, draftOverride, overrideError,
  toggleDay, addWindow, removeWindow, applyToWeek, createOverride,
  addOverride, formatDate, save
} = useScheduleEditor({
  open: () => props.open,
  schedule: () => props.schedule,
  onSaved: id => emit('saved', id),
  onClose: () => { isOpen.value = false }
})
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="Edit schedule"
    description="Set the weekly pattern and exceptions event types can use."
    scrollable
    :ui="{
      content: 'h-[calc(100dvh-2rem)] w-full max-w-none sm:h-[min(92dvh,56rem)] sm:max-w-5xl',
      header: 'border-b border-default px-5 py-4 sm:px-6 sm:py-5',
      body: 'min-h-0 flex-1 overflow-y-auto p-0 sm:p-0',
      footer: 'border-t border-default px-5 py-4 sm:px-6'
    }"
  >
    <template #body>
      <form
        id="schedule-editor-form"
        class="space-y-5 px-5 py-5 sm:px-6"
        @submit.prevent="save"
      >
        <section class="grid gap-5 rounded-xl border border-default bg-default p-5 sm:grid-cols-2">
          <UFormField
            label="Schedule name"
            required
          >
            <UInput
              v-model="name"
              maxlength="60"
              placeholder="Working hours"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Timezone"
            help="All hours in this schedule use this timezone."
          >
            <USelectMenu
              v-model="timeZone"
              :items="zones"
              :search-input="{ placeholder: 'Search timezones…' }"
              icon="i-lucide-globe"
              class="w-full"
            />
          </UFormField>
          <label class="flex cursor-pointer items-center justify-between gap-4 rounded-lg bg-muted px-4 py-3 sm:col-span-2">
            <span><span class="block text-[14px] font-medium text-highlighted">Default schedule</span><span class="mt-0.5 block text-[12px] text-muted">New event types will use this schedule automatically.</span></span>
            <USwitch
              v-model="isDefault"
              :disabled="schedule?.isDefault"
              aria-label="Set as default schedule"
            />
          </label>
        </section>

        <section class="overflow-hidden rounded-xl border border-default bg-default">
          <div class="surface-secondary flex flex-col gap-3 border-b border-default px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <ListFilter
              v-model="view"
              :options="viewOptions"
            />
            <UButton
              v-if="view === 'overrides'"
              color="neutral"
              variant="outline"
              size="sm"
              icon="i-lucide-plus"
              @click="createOverride"
            >
              Add date override
            </UButton>
            <p
              v-else
              class="text-[12px] text-muted"
            >
              Add up to three windows per day
            </p>
          </div>

          <ul
            v-if="view === 'weekly'"
            class="divide-y divide-default"
          >
            <li
              v-for="row in rows"
              :key="row.weekday"
              class="px-4 py-4 sm:px-5"
            >
              <div class="flex items-start gap-3">
                <USwitch
                  :model-value="row.enabled"
                  :aria-label="`Available on ${row.label}`"
                  class="mt-1"
                  @update:model-value="toggleDay(row)"
                />
                <div class="min-w-0 flex-1">
                  <div class="flex min-h-8 items-center justify-between gap-2">
                    <p
                      class="text-[14px] font-medium"
                      :class="row.enabled ? 'text-highlighted' : 'text-dimmed'"
                    >
                      {{ row.label }}
                    </p>
                    <div
                      v-if="row.enabled"
                      class="flex items-center gap-0.5"
                    >
                      <UButton
                        v-if="enabledCount > 1"
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        icon="i-lucide-copy"
                        class="size-7 justify-center p-0"
                        :ui="{ leadingIcon: 'size-4' }"
                        :aria-label="`Copy ${row.label} hours to enabled days`"
                        @click="applyToWeek(row)"
                      />
                      <UButton
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        icon="i-lucide-plus"
                        class="size-7 justify-center p-0"
                        :ui="{ leadingIcon: 'size-4' }"
                        :disabled="row.windows.length >= 3"
                        :aria-label="`Add hours on ${row.label}`"
                        @click="addWindow(row)"
                      />
                    </div>
                  </div>
                  <p
                    v-if="!row.enabled"
                    class="mt-1 text-[12px] text-dimmed"
                  >
                    Unavailable
                  </p>
                  <div
                    v-else
                    class="mt-2 space-y-2"
                  >
                    <div
                      v-for="window in row.windows"
                      :key="window.id"
                      class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:max-w-md sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]"
                    >
                      <TimeSelect v-model="window.start" />
                      <span class="text-[12px] text-dimmed">to</span>
                      <TimeSelect v-model="window.end" />
                      <UButton
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        icon="i-lucide-trash-2"
                        class="col-start-3 row-start-2 size-7 justify-self-end p-0 hover:text-error sm:col-start-auto sm:row-start-auto sm:justify-self-auto"
                        :ui="{ leadingIcon: 'size-4' }"
                        :aria-label="`Remove hours from ${row.label}`"
                        @click="removeWindow(row, window.id)"
                      />
                    </div>
                    <p
                      v-if="row.windows.some(window => window.end <= window.start)"
                      class="text-[12px] text-error"
                    >
                      Finish must be after start.
                    </p>
                  </div>
                </div>
              </div>
            </li>
          </ul>

          <template v-else>
            <ul
              v-if="overrides.length"
              class="divide-y divide-default"
            >
              <li
                v-for="override in overrides"
                :key="`${override.date}-${override.start ?? 'off'}`"
                class="flex items-center gap-4 px-5 py-4"
              >
                <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted"><UIcon
                  :name="override.start ? 'i-lucide-clock-3' : 'i-lucide-calendar-off'"
                  class="size-4"
                /></span>
                <div class="min-w-0 flex-1">
                  <p class="text-[14px] font-medium text-highlighted">
                    {{ formatDate(override.date) }}
                  </p><p class="mt-0.5 text-[12px] text-muted">
                    {{ override.start ? `${override.start}–${override.end}` : 'Unavailable all day' }}
                  </p>
                </div>
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-trash-2"
                  class="size-7 justify-center p-0 hover:text-error"
                  :ui="{ leadingIcon: 'size-4' }"
                  aria-label="Remove date override"
                  @click="overrides = overrides.filter(item => item.date !== override.date)"
                />
              </li>
            </ul>
            <ListEmptyState
              v-else
              icon="i-lucide-calendar-plus"
              title="No date overrides"
              description="Take a day off or offer different hours on one date without changing the weekly pattern."
            >
              <template #action>
                <UButton
                  icon="i-lucide-plus"
                  @click="createOverride"
                >
                  Add date override
                </UButton>
              </template>
            </ListEmptyState>
          </template>
        </section>
        <p
          v-if="error"
          class="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-[14px] text-error"
          role="alert"
        >
          {{ error }}
        </p>
      </form>
    </template>

    <template #footer>
      <ModalFooter :hint="dirty ? 'You have unsaved changes' : undefined">
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
            form="schedule-editor-form"
            :loading="saving"
            :disabled="invalid || !dirty"
          >
            Save schedule
          </UButton>
        </template>
      </ModalFooter>
    </template>

    <UModal
      v-model:open="overrideOpen"
      title="Add date override"
      description="Change this schedule for one date."
    >
      <template #body>
        <div class="space-y-5">
          <UFormField
            label="Date"
            required
          >
            <UInput
              v-model="draftOverride.date"
              type="date"
              :min="new Date().toISOString().slice(0, 10)"
              class="w-full"
            />
          </UFormField>
          <div class="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            <button
              type="button"
              class="rounded-md px-3 py-2 text-[14px] font-medium"
              :class="!draftOverride.available ? 'bg-default text-highlighted shadow-sm' : 'text-muted'"
              @click="draftOverride.available = false"
            >
              Unavailable
            </button>
            <button
              type="button"
              class="rounded-md px-3 py-2 text-[14px] font-medium"
              :class="draftOverride.available ? 'bg-default text-highlighted shadow-sm' : 'text-muted'"
              @click="draftOverride.available = true"
            >
              Custom hours
            </button>
          </div>
          <div
            v-if="draftOverride.available"
            class="grid grid-cols-[1fr_auto_1fr] items-end gap-2"
          >
            <UFormField label="Start">
              <TimeSelect v-model="draftOverride.start" />
            </UFormField><span class="pb-2 text-[12px] text-dimmed">to</span><UFormField label="Finish">
              <TimeSelect v-model="draftOverride.end" />
            </UFormField>
          </div>
          <p
            v-if="overrideError"
            class="text-[14px] text-error"
            role="alert"
          >
            {{ overrideError }}
          </p>
        </div>
      </template>
      <template #footer>
        <ModalFooter>
          <template #cancel>
            <UButton
              color="neutral"
              variant="soft"
              @click="overrideOpen = false"
            >
              Cancel
            </UButton>
          </template>
          <template #actions>
            <UButton
              @click="addOverride"
            >
              Add override
            </UButton>
          </template>
        </ModalFooter>
      </template>
    </UModal>
  </UModal>
</template>
