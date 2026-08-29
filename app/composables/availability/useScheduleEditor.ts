import { computed, reactive, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { apiErrorMessage, schedulesApi } from '~/services/schedra-api'
import type { ScheduleOverrideRecord, ScheduleRecord } from '~/types/schedule'

export interface ScheduleTimeWindow { id: number, start: string, end: string }
export interface ScheduleDayRow { weekday: number, label: string, enabled: boolean, windows: ScheduleTimeWindow[] }

const DAYS = [[1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday'], [7, 'Sunday']] as const
let windowId = 0

function newWindow(start = '09:00', end = '17:00'): ScheduleTimeWindow {
  return { id: ++windowId, start, end }
}

export function useScheduleEditor(options: {
  open: MaybeRefOrGetter<boolean>
  schedule: MaybeRefOrGetter<ScheduleRecord | null | undefined>
  onSaved: (id: string) => void
  onClose: () => void
}) {
  const zones = Intl.supportedValuesOf('timeZone')
  const name = ref('')
  const timeZone = ref('UTC')
  const isDefault = ref(false)
  const rows = ref<ScheduleDayRow[]>([])
  const overrides = ref<ScheduleOverrideRecord[]>([])
  const view = ref<'weekly' | 'overrides'>('weekly')
  const initial = ref('')
  const saving = ref(false)
  const error = ref('')
  const overrideOpen = ref(false)
  const draftOverride = reactive({ date: '', available: false, start: '09:00', end: '17:00' })
  const overrideError = ref('')

  function snapshot() {
    return JSON.stringify({ name: name.value, timeZone: timeZone.value, isDefault: isDefault.value, rows: rows.value, overrides: overrides.value })
  }

  function load() {
    const schedule = toValue(options.schedule)
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

  watch(() => toValue(options.open), (open) => {
    if (open) load()
  })
  watch(() => toValue(options.schedule), () => {
    if (toValue(options.open)) load()
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

  function toggleDay(row: ScheduleDayRow) {
    row.enabled = !row.enabled
    if (row.enabled && !row.windows.length) row.windows.push(newWindow())
  }

  function addWindow(row: ScheduleDayRow) {
    if (row.windows.length >= 3) return
    const start = row.windows.at(-1)?.end ?? '09:00'
    const endMinutes = Math.min(timeMinutes(start) + 120, 1425)
    const end = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`
    row.windows.push(newWindow(start, end))
  }

  function removeWindow(row: ScheduleDayRow, id: number) {
    if (row.windows.length === 1) row.enabled = false
    else row.windows = row.windows.filter(window => window.id !== id)
  }

  function applyToWeek(from: ScheduleDayRow) {
    for (const row of rows.value) {
      if (row.weekday !== from.weekday && row.enabled) {
        row.windows = from.windows.map(window => newWindow(window.start, window.end))
      }
    }
  }

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
    overrides.value.push({
      date: draftOverride.date,
      start: draftOverride.available ? draftOverride.start : null,
      end: draftOverride.available ? draftOverride.end : null
    })
    overrides.value.sort((a, b) => a.date.localeCompare(b.date))
    overrideOpen.value = false
  }

  function formatDate(date: string) {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${date}T12:00:00`))
  }

  async function save() {
    const schedule = toValue(options.schedule)
    if (!schedule || invalid.value) return
    saving.value = true
    error.value = ''
    try {
      await schedulesApi.update(schedule.id, {
        name: name.value, timeZone: timeZone.value, isDefault: isDefault.value,
        rules: rows.value.flatMap(row => row.enabled
          ? row.windows.map(window => ({ weekday: row.weekday, start: window.start, end: window.end }))
          : []),
        overrides: overrides.value
      })
      options.onSaved(schedule.id)
      options.onClose()
    } catch (failure) {
      error.value = apiErrorMessage(failure, 'Could not save this schedule just now.')
    } finally {
      saving.value = false
    }
  }

  return {
    zones, name, timeZone, isDefault, rows, overrides, view, saving, error,
    enabledCount, invalid, dirty, viewOptions, overrideOpen, draftOverride,
    overrideError, toggleDay, addWindow, removeWindow, applyToWeek,
    createOverride, addOverride, formatDate, save
  }
}
