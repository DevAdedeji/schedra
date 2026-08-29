import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import {
  apiErrorMessage,
  calendarIntegrationApi,
  type CalendarConnection,
  type CalendarIntegrationProvider,
  type CalendarItem
} from '~/services/schedra-api'

export async function useCalendarIntegration(options: {
  provider: CalendarIntegrationProvider
  name: MaybeRefOrGetter<string>
  refreshSignal: MaybeRefOrGetter<number | undefined>
  onSaved: () => void
}) {
  const feedback = useFeedback()
  const api = calendarIntegrationApi(options.provider)
  const { data: connection, refresh: refreshConnection, status, error: connectionFailure }
    = await useLazyFetch<CalendarConnection>(api.connectionEndpoint)
  const settingsOpen = ref(false)
  const disconnectOpen = ref(false)
  const calendars = ref<CalendarItem[]>([])
  const selectedConflictIds = ref<string[]>([])
  const writeCalendarId = ref('')
  const defaultForBookings = ref(false)
  const baseline = ref('')
  const loadingCalendars = ref(false)
  const calendarsLoaded = ref(false)
  const calendarFailure = ref('')
  const pageError = ref('')
  const saving = ref(false)
  const disconnecting = ref(false)
  const isGoogle = computed(() => options.provider === 'google-calendar')

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
    write: writeCalendarId.value,
    defaultForBookings: defaultForBookings.value
  }))
  const dirty = computed(() => currentSnapshot.value !== baseline.value)
  const writeCalendarMissing = computed(() => Boolean(
    writeCalendarId.value && !writableCalendars.value.some(calendar => calendar.value === writeCalendarId.value)
  ))

  function relationship(calendar: CalendarItem) {
    if (calendar.unavailable) return `No longer available in this ${toValue(options.name)} account`
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
      defaultForBookings.value = Boolean(connection.value?.defaultForBookings)
      baseline.value = currentSnapshot.value
      calendarsLoaded.value = true
    } catch (failure) {
      calendarFailure.value = apiErrorMessage(failure, `Could not load calendars from ${toValue(options.name)} just now.`)
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
      const result = await api.update({
        conflictCalendarIds: selectedConflictIds.value,
        writeCalendarId: writeCalendarId.value,
        defaultForBookings: defaultForBookings.value
      })
      baseline.value = currentSnapshot.value
      await refreshConnection()
      options.onSaved()
      if (result.syncQueued) feedback.success({ title: `${toValue(options.name)} preferences saved` })
      else {
        feedback.warning({
          title: `${toValue(options.name)} preferences saved`,
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
      defaultForBookings.value = false
      await refreshConnection()
      options.onSaved()
      feedback.success({ title: `${toValue(options.name)} disconnected` })
    } catch (failure) {
      pageError.value = apiErrorMessage(failure, `Could not disconnect ${toValue(options.name)} just now.`)
    } finally {
      disconnecting.value = false
    }
  }

  watch(settingsOpen, (open) => {
    if (open && connection.value?.connected) void loadCalendars()
  })
  watch(() => toValue(options.refreshSignal), async (next, previous) => {
    if (!next || next === previous) return
    await refreshConnection()
    if (settingsOpen.value && connection.value?.connected) await loadCalendars(true)
  })

  return {
    api, connection, refreshConnection, status, connectionFailure, settingsOpen,
    disconnectOpen, calendars, selectedConflictIds, writeCalendarId,
    defaultForBookings, loadingCalendars, calendarFailure, pageError, saving,
    disconnecting, isGoogle, writableCalendars, conflictCalendars, dirty,
    writeCalendarMissing, relationship, toggleConflict, loadCalendars,
    retryConnection, save, disconnect
  }
}
