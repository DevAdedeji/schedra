import { computed, onMounted, ref, toValue, watch, watchEffect, type MaybeRefOrGetter, type Ref } from 'vue'
import { lastBookingCalendarWeek } from '#shared/booking-calendar'
import type { AvailabilityResponse, PublicBookingPage } from '~/services/schedra-api'
import {
  addLocalCalendarDays,
  calendarDateKey,
  calendarDaysBetween,
  formatCalendarDate,
  formatInstant,
  formatTime,
  localCalendarDate,
  localTimeZone,
  startOfIsoWeek
} from '~/utils/date-time'

export function isoCalendarDate(date: Date) {
  return localCalendarDate(date)
}

export function addCalendarDays(date: Date, count: number) {
  return addLocalCalendarDays(date, count)
}

export function useBookingCalendar(options: {
  availability: MaybeRefOrGetter<AvailabilityResponse | null | undefined>
  page: MaybeRefOrGetter<PublicBookingPage | null | undefined>
  weekOffset?: Ref<number>
}) {
  const viewerTimeZone = ref('UTC')
  const viewerTimeZoneReady = ref(false)
  const zones = Intl.supportedValuesOf('timeZone')
  const weekOffset = options.weekOffset ?? ref(0)
  const selectedDate = ref<string | null>(null)
  const selectedSlot = ref<string | null>(null)
  const jumped = ref(false)

  onMounted(() => {
    viewerTimeZone.value = localTimeZone()
    viewerTimeZoneReady.value = true
  })
  watch(viewerTimeZone, () => {
    selectedDate.value = null
    selectedSlot.value = null
    jumped.value = false
  })

  const today = new Date()
  const firstMonday = addCalendarDays(today, -((today.getDay() + 6) % 7))
  const maxWeekOffset = computed(() => lastBookingCalendarWeek(
    isoCalendarDate(firstMonday), today.toISOString(), toValue(options.page)?.bookingWindowDays, viewerTimeZone.value
  ))
  watch(maxWeekOffset, (maximum) => {
    if (weekOffset.value > maximum) weekOffset.value = maximum
  })
  const weekStart = computed(() => addCalendarDays(firstMonday, weekOffset.value * 7))
  const days = computed(() => Array.from({ length: 7 }, (_, index) => addCalendarDays(weekStart.value, index)))
  const slotsByDate = computed(() => {
    const grouped = new Map<string, AvailabilityResponse['slots']>()
    const availability = toValue(options.availability)
    if (!availability) return grouped
    for (const slot of availability.slots) {
      const key = calendarDateKey(slot.start, viewerTimeZone.value)
      grouped.set(key, [...(grouped.get(key) ?? []), slot])
    }
    return grouped
  })

  watchEffect(() => {
    if (!viewerTimeZoneReady.value || jumped.value || !slotsByDate.value.size) return
    if (weekOffset.value > 0) {
      jumped.value = true
      return
    }
    const first = [...slotsByDate.value.keys()].sort()[0]!
    const monday = startOfIsoWeek(first)
    weekOffset.value = Math.min(maxWeekOffset.value, Math.max(0,
      Math.round(calendarDaysBetween(isoCalendarDate(firstMonday), monday) / 7)))
    selectedDate.value = first
    jumped.value = true
  })
  watchEffect(() => {
    const visibleDates = days.value.map(isoCalendarDate)
    if (
      selectedDate.value
      && visibleDates.includes(selectedDate.value)
      && slotsByDate.value.has(selectedDate.value)
    ) return

    const inWeek = visibleDates.find(key => slotsByDate.value.has(key)) ?? null
    if (selectedDate.value !== inWeek) selectedSlot.value = null
    selectedDate.value = inWeek
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
  const monthLabel = computed(() => formatInstant(weekStart.value, { month: 'long', year: 'numeric' }, 'en'))
  const longSelected = computed(() => selectedDate.value
    ? formatCalendarDate(selectedDate.value, { weekday: 'long', day: 'numeric', month: 'long' }, 'en')
    : '')

  function timeLabel(iso: string) {
    return formatTime(iso, viewerTimeZone.value)
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
