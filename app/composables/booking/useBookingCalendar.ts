import { computed, onMounted, ref, toValue, watch, watchEffect, type MaybeRefOrGetter } from 'vue'
import type { AvailabilityResponse, PublicBookingPage } from '~/services/schedra-api'

export function isoCalendarDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function addCalendarDays(date: Date, count: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count)
}

export function useBookingCalendar(options: {
  availability: MaybeRefOrGetter<AvailabilityResponse | null | undefined>
  page: MaybeRefOrGetter<PublicBookingPage | null | undefined>
}) {
  const viewerTimeZone = ref('UTC')
  const viewerTimeZoneReady = ref(false)
  const zones = Intl.supportedValuesOf('timeZone')
  const weekOffset = ref(0)
  const maxWeekOffset = 8
  const selectedDate = ref<string | null>(null)
  const selectedSlot = ref<string | null>(null)
  const jumped = ref(false)

  onMounted(() => {
    viewerTimeZone.value = Intl.DateTimeFormat().resolvedOptions().timeZone
    viewerTimeZoneReady.value = true
  })
  watch(viewerTimeZone, () => {
    selectedDate.value = null
    selectedSlot.value = null
    jumped.value = false
  })

  const today = new Date()
  const firstMonday = addCalendarDays(today, -((today.getDay() + 6) % 7))
  const weekStart = computed(() => addCalendarDays(firstMonday, weekOffset.value * 7))
  const days = computed(() => Array.from({ length: 7 }, (_, index) => addCalendarDays(weekStart.value, index)))
  const slotsByDate = computed(() => {
    const grouped = new Map<string, AvailabilityResponse['slots']>()
    const availability = toValue(options.availability)
    if (!availability) return grouped
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: viewerTimeZone.value })
    for (const slot of availability.slots) {
      const key = formatter.format(new Date(slot.start))
      grouped.set(key, [...(grouped.get(key) ?? []), slot])
    }
    return grouped
  })

  watchEffect(() => {
    if (jumped.value || !slotsByDate.value.size) return
    const first = [...slotsByDate.value.keys()].sort()[0]!
    const target = new Date(`${first}T12:00:00`)
    const monday = addCalendarDays(target, -((target.getDay() + 6) % 7))
    weekOffset.value = Math.min(maxWeekOffset, Math.max(0,
      Math.round((monday.getTime() - firstMonday.getTime()) / 6048e5)))
    selectedDate.value = first
    jumped.value = true
  })
  watchEffect(() => {
    if (selectedDate.value && slotsByDate.value.has(selectedDate.value)) return
    const inWeek = days.value.map(isoCalendarDate).find(key => slotsByDate.value.has(key))
    if (inWeek) selectedDate.value = inWeek
  })

  const daySlots = computed(() => selectedDate.value ? slotsByDate.value.get(selectedDate.value) ?? [] : [])
  const hasAnything = computed(() => slotsByDate.value.size > 0)
  const selectedSlotDetails = computed(() => daySlots.value.find(slot => slot.start === selectedSlot.value))
  const additionalGuestLimit = computed(() => {
    const page = toValue(options.page)
    if (!page || page.capacity === 1) return 10
    const remainingSeats = selectedSlotDetails.value?.availableSeats ?? page.capacity
    return Math.max(0, Math.min(10, remainingSeats - 1))
  })
  const monthLabel = computed(() =>
    new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(weekStart.value))
  const longSelected = computed(() => selectedDate.value
    ? new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${selectedDate.value}T12:00:00`))
    : '')

  function timeLabel(iso: string) {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', timeZone: viewerTimeZone.value
    }).format(new Date(iso))
  }

  function locationLabel(type?: string) {
    return ({
      google_meet: 'Google Meet', microsoft_teams: 'Microsoft Teams', zoom: 'Zoom',
      video_link: 'Video call', phone: 'Phone call', in_person: 'In person', custom: 'Meeting details'
    } as Record<string, string>)[type ?? ''] ?? 'Meeting details'
  }

  function locationIcon(type?: string) {
    return ({
      google_meet: 'i-simple-icons-googlemeet', microsoft_teams: 'i-simple-icons-microsoftteams',
      zoom: 'i-simple-icons-zoom', video_link: 'i-lucide-video', phone: 'i-lucide-phone',
      in_person: 'i-lucide-map-pin', custom: 'i-lucide-message-square-text'
    } as Record<string, string>)[type ?? ''] ?? 'i-lucide-map-pin'
  }

  return {
    viewerTimeZone, viewerTimeZoneReady, zones, weekOffset, maxWeekOffset,
    selectedDate, selectedSlot, firstMonday, weekStart, days, slotsByDate,
    daySlots, hasAnything, selectedSlotDetails, additionalGuestLimit,
    monthLabel, longSelected, timeLabel, locationLabel, locationIcon,
    isoDate: isoCalendarDate
  }
}
