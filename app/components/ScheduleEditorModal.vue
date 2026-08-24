<script setup lang="ts">
import { apiErrorMessage, schedulesApi } from '~/services/schedra-api'
import type { ScheduleOverrideRecord, ScheduleRecord } from '~/types/schedule'

const props = defineProps<{ open: boolean, schedule?: ScheduleRecord | null }>()
const emit = defineEmits<{ 'update:open': [value: boolean], 'saved': [id: string] }>()

interface TimeWindow { id: number, start: string, end: string }
interface DayRow { weekday: number, label: string, enabled: boolean, windows: TimeWindow[] }
const DAYS = [[1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday'], [7, 'Sunday']] as const
const zones = Intl.supportedValuesOf('timeZone')
let windowId = 0

const isOpen = computed({ get: () => props.open, set: value => emit('update:open', value) })
const name = ref('')
const timeZone = ref('UTC')
const isDefault = ref(false)
const rows = ref<DayRow[]>([])
const overrides = ref<ScheduleOverrideRecord[]>([])
const view = ref<'weekly' | 'overrides'>('weekly')
const initial = ref('')
const saving = ref(false)
const error = ref('')

function newWindow(start = '09:00', end = '17:00'): TimeWindow {
  return { id: ++windowId, start, end }
}

function snapshot() {
  return JSON.stringify({ name: name.value, timeZone: timeZone.value, isDefault: isDefault.value, rows: rows.value, overrides: overrides.value })
}

function load() {
  const schedule = props.schedule
  if (!schedule) return
  name.value = schedule.name
  timeZone.value = schedule.timeZone
  isDefault.value = schedule.isDefault
  rows.value = DAYS.map(([weekday, label]) => {
    const rules = schedule.rules.filter(rule => rule.weekday === weekday)
    return { weekday, label, enabled: rules.length > 0, windows: rules.length ? rules.map(rule => newWindow(rule.start, rule.end)) : [newWindow()] }
  })
  overrides.value = schedule.overrides.map(override => ({ ...override }))
  view.value = 'weekly'
  error.value = ''
  initial.value = snapshot()
}

watch(() => props.open, (open) => {
  if (open) load()
})
watch(() => props.schedule, () => {
  if (props.open) load()
})

const enabledCount = computed(() => rows.value.filter(row => row.enabled).length)
const invalid = computed(() => !name.value.trim() || rows.value.some(row => row.enabled && row.windows.some(window => window.end <= window.start)))
const dirty = computed(() => snapshot() !== initial.value)
const viewOptions = computed(() => [
  { value: 'weekly', label: 'Weekly hours', count: enabledCount.value },
  { value: 'overrides', label: 'Date overrides', count: overrides.value.length }
])

function timeMinutes(value: string) {
  const [hour = 0, minute = 0] = value.split(':').map(Number)
  return hour * 60 + minute
}

function toggleDay(row: DayRow) {
  row.enabled = !row.enabled
  if (row.enabled && !row.windows.length) row.windows.push(newWindow())
}

function addWindow(row: DayRow) {
  if (row.windows.length >= 3) return
  const start = row.windows.at(-1)?.end ?? '09:00'
  const endMinutes = Math.min(timeMinutes(start) + 120, 1425)
  const end = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`
  row.windows.push(newWindow(start, end))
}

function removeWindow(row: DayRow, id: number) {
  if (row.windows.length === 1) row.enabled = false
  else row.windows = row.windows.filter(window => window.id !== id)
}

function applyToWeek(from: DayRow) {
  for (const row of rows.value) {
    if (row.weekday !== from.weekday && row.enabled) {
      row.windows = from.windows.map(window => newWindow(window.start, window.end))
    }
  }
}

const overrideOpen = ref(false)
const draftOverride = reactive({ date: '', available: false, start: '09:00', end: '17:00' })
const overrideError = ref('')

function createOverride() {
  Object.assign(draftOverride, { date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), available: false, start: '09:00', end: '17:00' })
  overrideError.value = ''
  overrideOpen.value = true
}

function addOverride() {
  if (!draftOverride.date) {
    overrideError.value = 'Choose a date.'
    return
  }
  if (draftOverride.available && draftOverride.end <= draftOverride.start) {
    overrideError.value = 'The finish must come after the start.'
    return
  }
  overrides.value = overrides.value.filter(item => item.date !== draftOverride.date)
  overrides.value.push({ date: draftOverride.date, start: draftOverride.available ? draftOverride.start : null, end: draftOverride.available ? draftOverride.end : null })
  overrides.value.sort((a, b) => a.date.localeCompare(b.date))
  overrideOpen.value = false
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${date}T12:00:00`))
}

async function save() {
  if (!props.schedule || invalid.value) return
  saving.value = true
  error.value = ''
  try {
    await schedulesApi.update(props.schedule.id, {
      name: name.value,
      timeZone: timeZone.value,
      isDefault: isDefault.value,
      rules: rows.value.flatMap(row => row.enabled ? row.windows.map(window => ({ weekday: row.weekday, start: window.start, end: window.end })) : []),
      overrides: overrides.value
    })
    emit('saved', props.schedule.id)
    isOpen.value = false
  } catch (failure) {
    error.value = apiErrorMessage(failure, 'Could not save this schedule just now.')
  } finally {
    saving.value = false
  }
}
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
            <span><span class="block text-[13px] font-medium text-highlighted">Default schedule</span><span class="mt-0.5 block text-[11px] text-muted">New event types will use this schedule automatically.</span></span>
            <USwitch
              v-model="isDefault"
              :disabled="schedule?.isDefault"
              aria-label="Set as default schedule"
            />
          </label>
        </section>

        <section class="overflow-hidden rounded-xl border border-default bg-default">
          <div class="flex flex-col gap-3 border-b border-default px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
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
              class="text-[11px] text-muted"
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
                      class="text-[13px] font-medium"
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
                    class="mt-1 text-[11px] text-dimmed"
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
                      class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-2 sm:max-w-md"
                    >
                      <TimeSelect v-model="window.start" />
                      <span class="text-[11px] text-dimmed">to</span>
                      <TimeSelect v-model="window.end" />
                      <UButton
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        icon="i-lucide-trash-2"
                        class="size-7 justify-center p-0 hover:text-error"
                        :ui="{ leadingIcon: 'size-4' }"
                        :aria-label="`Remove hours from ${row.label}`"
                        @click="removeWindow(row, window.id)"
                      />
                    </div>
                    <p
                      v-if="row.windows.some(window => window.end <= window.start)"
                      class="text-[11px] text-error"
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
                  <p class="text-[13px] font-medium text-highlighted">
                    {{ formatDate(override.date) }}
                  </p><p class="mt-0.5 text-[11px] text-muted">
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
          class="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-[13px] text-error"
          role="alert"
        >
          {{ error }}
        </p>
      </form>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-between gap-3">
        <p class="hidden text-[12px] text-muted sm:block">
          {{ dirty ? 'You have unsaved changes' : 'No unsaved changes' }}
        </p>
        <div class="ml-auto flex gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="saving"
            @click="isOpen = false"
          >
            Cancel
          </UButton><UButton
            type="submit"
            form="schedule-editor-form"
            icon="i-lucide-check"
            :loading="saving"
            :disabled="invalid || !dirty"
          >
            Save schedule
          </UButton>
        </div>
      </div>
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
              class="rounded-md px-3 py-2 text-[13px] font-medium"
              :class="!draftOverride.available ? 'bg-default text-highlighted shadow-sm' : 'text-muted'"
              @click="draftOverride.available = false"
            >
              Unavailable
            </button>
            <button
              type="button"
              class="rounded-md px-3 py-2 text-[13px] font-medium"
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
            </UFormField><span class="pb-2 text-[11px] text-dimmed">to</span><UFormField label="Finish">
              <TimeSelect v-model="draftOverride.end" />
            </UFormField>
          </div>
          <p
            v-if="overrideError"
            class="text-[13px] text-error"
            role="alert"
          >
            {{ overrideError }}
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="overrideOpen = false"
          >
            Cancel
          </UButton><UButton
            icon="i-lucide-check"
            @click="addOverride"
          >
            Add override
          </UButton>
        </div>
      </template>
    </UModal>
  </UModal>
</template>
