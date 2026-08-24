<script setup lang="ts">
import { bookingsApi, publicBookingApi, type AvailabilityResponse, type PublicBookingPage } from '~/services/schedra-api'

definePageMeta({ layout: 'bare' })

const route = useRoute()
const username = String(route.params.username)
const slug = String(route.params.slug)
const rescheduleOf = computed(() => {
  const value = route.query.reschedule
  return typeof value === 'string' && value ? value : undefined
})

const viewerTimeZone = ref('UTC')
const zones = Intl.supportedValuesOf('timeZone')
const weekOffset = ref(0)
const maxWeekOffset = 8
const selectedDate = ref<string | null>(null)
const selectedSlot = ref<string | null>(null)
const jumped = ref(false)

onMounted(() => {
  viewerTimeZone.value = Intl.DateTimeFormat().resolvedOptions().timeZone
})

watch(viewerTimeZone, () => {
  selectedDate.value = null
  selectedSlot.value = null
  jumped.value = false
})

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function addDays(date: Date, count: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count)
}

const today = new Date()
const firstMonday = addDays(today, -((today.getDay() + 6) % 7))

const weekStart = computed(() => addDays(firstMonday, weekOffset.value * 7))
const days = computed(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart.value, i)))

const availabilityRequest = useFetch<AvailabilityResponse>(publicBookingApi.availabilityEndpoint, {
  query: { username, slug, from: isoDate(firstMonday), to: isoDate(addDays(firstMonday, 62)) }
})

const pageRequest = useFetch<PublicBookingPage>(publicBookingApi.pageEndpoint(username, slug))
const [
  { data, status, error: availabilityError, refresh },
  { data: page, status: pageStatus, error: pageError, refresh: refreshPage }
] = await Promise.all([availabilityRequest, pageRequest])

const initialPageError = pageError.value ?? availabilityError.value
if (initialPageError) setResponseStatus(initialPageError.statusCode === 404 ? 404 : 503)

const missingPage = computed(() => pageError.value?.statusCode === 404 || availabilityError.value?.statusCode === 404)
const loadingFailure = computed(() => pageError.value && !missingPage.value ? pageError.value : availabilityError.value)
const initialLoading = computed(() => !page.value && !loadingFailure.value && (pageStatus.value === 'pending' || status.value === 'pending'))
const retrying = computed(() => pageStatus.value === 'pending' || status.value === 'pending')

async function retryBookingPage() {
  await Promise.allSettled([refresh(), refreshPage()])
}
const rescheduleBooking = ref<{
  attendeeName: string
  attendeeEmail: string
} | null>(null)
if (rescheduleOf.value) {
  rescheduleBooking.value = await bookingsApi.get(rescheduleOf.value)
    .catch(() => null)
}

const slotsByDate = computed(() => {
  const grouped = new Map<string, string[]>()
  if (!data.value) return grouped

  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: viewerTimeZone.value })
  for (const slot of data.value.slots) {
    const key = formatter.format(new Date(slot.start))
    grouped.set(key, [...(grouped.get(key) ?? []), slot.start])
  }
  return grouped
})

watchEffect(() => {
  if (jumped.value || !slotsByDate.value.size) return

  const first = [...slotsByDate.value.keys()].sort()[0]!
  const target = new Date(`${first}T12:00:00`)
  const monday = addDays(target, -((target.getDay() + 6) % 7))
  weekOffset.value = Math.min(maxWeekOffset, Math.max(0,
    Math.round((monday.getTime() - firstMonday.getTime()) / 6048e5)))
  selectedDate.value = first
  jumped.value = true
})

watchEffect(() => {
  if (selectedDate.value && slotsByDate.value.has(selectedDate.value)) return
  const inWeek = days.value.map(isoDate).find(key => slotsByDate.value.has(key))
  if (inWeek) selectedDate.value = inWeek
})

const daySlots = computed(() => (selectedDate.value ? slotsByDate.value.get(selectedDate.value) ?? [] : []))
const hasAnything = computed(() => slotsByDate.value.size > 0)

function timeLabel(iso: string) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: viewerTimeZone.value
  }).format(new Date(iso))
}

const monthLabel = computed(() =>
  new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(weekStart.value))

const longSelected = computed(() => selectedDate.value
  ? new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${selectedDate.value}T12:00:00`))
  : '')

const booking = reactive({ name: '', email: '', notes: '' })
if (rescheduleBooking.value) {
  booking.name = rescheduleBooking.value.attendeeName
  booking.email = rescheduleBooking.value.attendeeEmail
}
const submitting = ref(false)
const bookingError = ref('')
const confirmed = ref<{
  start: string
  uid: string
  locationType: string
  locationDetails: string
  meetingUrl: string | null
} | null>(null)

const confirmedWhen = computed(() => confirmed.value
  ? new Intl.DateTimeFormat('en', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
      timeZone: viewerTimeZone.value
    }).format(new Date(confirmed.value.start))
  : '')

function locationLabel(type?: string) {
  return ({
    google_meet: 'Google Meet',
    video_link: 'Video call',
    phone: 'Phone call',
    in_person: 'In person',
    custom: 'Meeting details'
  } as Record<string, string>)[type ?? ''] ?? 'Meeting details'
}

function locationIcon(type?: string) {
  return ({
    google_meet: 'i-simple-icons-googlemeet',
    video_link: 'i-lucide-video',
    phone: 'i-lucide-phone',
    in_person: 'i-lucide-map-pin',
    custom: 'i-lucide-message-square-text'
  } as Record<string, string>)[type ?? ''] ?? 'i-lucide-map-pin'
}

async function confirm() {
  if (!selectedSlot.value) return

  submitting.value = true
  bookingError.value = ''

  try {
    const result = await bookingsApi.create({
      username,
      slug,
      start: selectedSlot.value,
      name: booking.name,
      email: booking.email,
      timeZone: viewerTimeZone.value,
      notes: booking.notes || undefined,
      rescheduleOf: rescheduleOf.value
    })
    confirmed.value = {
      start: result.start,
      uid: result.uid,
      locationType: result.locationType,
      locationDetails: result.locationDetails,
      meetingUrl: result.meetingUrl
    }
  } catch (failure) {
    const code = (failure as { statusCode?: number }).statusCode
    bookingError.value = code === 409
      ? 'Someone just took that time. Please pick another.'
      : 'Could not book that just now. Check your details and try again.'
    if (code === 409) {
      selectedSlot.value = null
      await refresh()
    }
  } finally {
    submitting.value = false
  }
}

const { url: siteUrl, indexable } = useSiteUrl()
const seoDescription = computed(() => page.value?.description
  || (page.value
    ? `${page.value.durationMinutes}-minute meeting with ${page.value.hostName}. Choose an available time online.`
    : 'Choose an available time and book a meeting online with Schedra.'))

useSeoMeta({
  title: () => page.value ? `${page.value.title} with ${page.value.hostName}` : 'Book a time',
  description: () => seoDescription.value,
  robots: () => indexable.value && page.value ? 'index, follow' : 'noindex, nofollow',
  ogType: 'website',
  ogTitle: () => page.value ? `${page.value.title} with ${page.value.hostName}` : 'Book a time with Schedra',
  ogDescription: () => seoDescription.value,
  ogUrl: () => `${siteUrl.value}/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`,
  twitterCard: 'summary_large_image',
  twitterTitle: () => page.value ? `${page.value.title} with ${page.value.hostName}` : 'Book a time with Schedra',
  twitterDescription: () => seoDescription.value
})
</script>

<template>
  <div class="flex min-h-screen flex-col bg-muted">
    <div class="flex-1 px-5">
      <div class="mx-auto max-w-4xl">
        <div class="pt-6 pb-12">
          <NuxtLink to="/">
            <SchedraMark />
          </NuxtLink>
        </div>

        <div
          v-if="initialLoading"
          class="grid overflow-hidden rounded-2xl border border-default bg-default md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]"
          role="status"
          aria-label="Loading booking page"
        >
          <div class="space-y-4 border-b border-default px-7 py-8 md:border-b-0 md:border-r sm:px-8">
            <USkeleton class="h-8 w-3/4 rounded" />
            <USkeleton class="h-4 w-1/2 rounded" />
            <USkeleton class="h-4 w-full rounded" />
            <USkeleton class="h-4 w-5/6 rounded" />
          </div>
          <div class="space-y-5 px-7 py-8 sm:px-8">
            <USkeleton class="h-6 w-40 rounded" />
            <div class="grid grid-cols-7 gap-2">
              <USkeleton
                v-for="day in 7"
                :key="day"
                class="h-14 w-full rounded-lg"
              />
            </div>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <USkeleton
                v-for="slot in 6"
                :key="slot"
                class="h-11 w-full rounded-lg"
              />
            </div>
          </div>
        </div>

        <div
          v-else-if="missingPage"
          class="rounded-2xl border border-default bg-default px-8 py-16 text-center"
        >
          <h1 class="font-editorial text-4xl text-highlighted">
            Nothing here.
          </h1>
          <p class="mt-4 text-base text-muted">
            This booking link does not exist, or it has been taken down.
          </p>
        </div>

        <div
          v-else-if="loadingFailure"
          class="overflow-hidden rounded-2xl border border-default bg-default"
        >
          <AsyncErrorState
            title="Could not load booking times"
            description="This booking page is still here, but its available times could not be loaded. Check your connection and try again."
            :retrying="retrying"
            @retry="retryBookingPage"
          />
        </div>

        <div
          v-else-if="confirmed"
          data-testid="booking-confirmation"
          class="rounded-2xl border border-default bg-default px-8 py-16 text-center"
        >
          <div class="mb-6 flex justify-center">
            <div
              class="flex items-center justify-center rounded-full bg-primary"
              style="width: 64px; height: 64px"
            >
              <UIcon
                name="i-lucide-check"
                class="size-7 text-inverted"
              />
            </div>
          </div>
          <h1 class="font-editorial text-4xl text-highlighted">
            You're booked.
          </h1>
          <p class="mx-auto mt-4 max-w-sm text-base leading-relaxed text-muted">
            {{ confirmedWhen }}, with {{ page?.hostName }}.
          </p>
          <div class="mx-auto mt-5 flex max-w-md items-start gap-3 rounded-xl border border-default bg-muted px-4 py-3 text-left">
            <UIcon
              :name="locationIcon(confirmed.locationType)"
              class="mt-0.5 size-4 shrink-0 text-primary"
            />
            <div class="min-w-0">
              <p class="text-[13px] font-medium text-highlighted">
                {{ locationLabel(confirmed.locationType) }}
              </p>
              <a
                v-if="confirmed.meetingUrl"
                :href="confirmed.meetingUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="mt-0.5 block truncate text-[12px] text-primary hover:underline"
              >Join meeting</a>
              <p
                v-else
                class="mt-0.5 text-[12px] leading-relaxed text-muted"
              >
                {{ confirmed.locationType === 'google_meet' ? 'Your private join link is being prepared and will appear in the booking details.' : confirmed.locationDetails }}
              </p>
            </div>
          </div>
          <p class="mt-2 text-sm text-dimmed">
            A confirmation will be sent to {{ booking.email }}.
          </p>
          <UButton
            :to="`/booking/${confirmed.uid}`"
            color="neutral"
            variant="outline"
            size="lg"
            class="mt-7 font-medium"
          >
            View or change booking
          </UButton>
        </div>

        <div
          v-else
          class="overflow-hidden rounded-2xl border border-default bg-default lg:grid lg:grid-cols-[17rem_1fr]"
        >
          <aside class="border-b border-default px-6 py-7 sm:px-7 lg:border-b-0 lg:border-r">
            <div
              v-if="rescheduleOf"
              class="mb-5 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-[12px] leading-relaxed text-toned"
            >
              <UIcon
                name="i-lucide-calendar-sync"
                class="mt-0.5 size-3.5 shrink-0 text-primary"
              />
              Choose a new time. Your name and email are already filled in.
            </div>
            <p class="text-sm text-muted">
              {{ page?.hostName }}
            </p>
            <h1 class="mt-1.5 font-editorial text-3xl leading-tight text-highlighted">
              {{ page?.title }}
            </h1>

            <div class="mt-6 space-y-2.5 text-sm text-toned">
              <p class="flex items-center gap-2.5">
                <UIcon
                  name="i-lucide-clock"
                  class="size-4 shrink-0 text-dimmed"
                />
                {{ page?.durationMinutes }} minutes
              </p>
              <div class="flex items-start gap-2.5">
                <UIcon
                  :name="locationIcon(page?.locationType)"
                  class="mt-0.5 size-4 shrink-0 text-dimmed"
                />
                <div class="min-w-0">
                  <p class="text-toned">
                    {{ locationLabel(page?.locationType) }}
                  </p>
                  <p class="mt-0.5 text-[12px] leading-relaxed text-muted">
                    {{ page?.locationDetails }}
                  </p>
                </div>
              </div>
              <div class="flex items-start gap-2.5">
                <UIcon
                  name="i-lucide-globe"
                  class="mt-2.5 size-4 shrink-0 text-dimmed"
                />
                <USelectMenu
                  v-model="viewerTimeZone"
                  :items="zones"
                  :search-input="{ placeholder: 'Search timezones…' }"
                  aria-label="Timezone"
                  size="sm"
                  class="min-h-11 min-w-0 flex-1 sm:min-h-9"
                />
              </div>
            </div>

            <p
              v-if="page?.description"
              class="mt-6 border-t border-default pt-6 text-sm leading-relaxed text-muted"
            >
              {{ page.description }}
            </p>
          </aside>

          <div class="px-6 py-7 sm:px-7">
            <div class="flex items-center justify-between">
              <h2 class="text-sm font-semibold text-highlighted">
                {{ monthLabel }}
              </h2>
              <div class="flex items-center gap-1">
                <UButton
                  icon="i-lucide-chevron-left"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  class="size-11 justify-center"
                  :disabled="weekOffset <= 0"
                  aria-label="Previous week"
                  @click="weekOffset--"
                />
                <UButton
                  icon="i-lucide-chevron-right"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  class="size-11 justify-center"
                  :disabled="weekOffset >= maxWeekOffset"
                  aria-label="Next week"
                  @click="weekOffset++"
                />
              </div>
            </div>

            <div class="mt-4 grid grid-cols-7 gap-1">
              <button
                v-for="day in days"
                :key="isoDate(day)"
                data-testid="booking-day"
                type="button"
                class="rounded-lg py-2 text-center transition-colors"
                :class="selectedDate === isoDate(day)
                  ? 'bg-primary text-inverted'
                  : slotsByDate.has(isoDate(day))
                    ? 'text-highlighted hover:bg-muted'
                    : 'cursor-not-allowed text-dimmed opacity-40'"
                :disabled="!slotsByDate.has(isoDate(day))"
                :aria-label="new Intl.DateTimeFormat('en', { dateStyle: 'full' }).format(day)"
                :aria-pressed="selectedDate === isoDate(day)"
                @click="selectedDate = isoDate(day); selectedSlot = null"
              >
                <span class="block text-[10px] font-semibold uppercase tracking-wide opacity-70">
                  {{ new Intl.DateTimeFormat('en', { weekday: 'short' }).format(day).slice(0, 2) }}
                </span>
                <span class="tnum mt-0.5 block text-[15px] font-semibold">{{ day.getDate() }}</span>
              </button>
            </div>

            <div class="mt-6">
              <div
                v-if="status === 'pending'"
                class="space-y-3"
                aria-label="Loading available times"
                aria-busy="true"
                role="status"
              >
                <USkeleton class="h-3 w-36" />
                <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <USkeleton
                    v-for="slot in 6"
                    :key="slot"
                    class="h-11 w-full rounded-lg"
                  />
                </div>
              </div>

              <p
                v-else-if="!hasAnything"
                class="py-16 text-center text-sm text-dimmed"
              >
                No free times in the next nine weeks.
              </p>

              <template v-else-if="daySlots.length">
                <p class="text-[13px] font-medium text-muted">
                  {{ longSelected }}
                </p>
                <div class="tnum mt-3 grid max-h-64 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
                  <button
                    v-for="slot in daySlots"
                    :key="slot"
                    data-testid="booking-slot"
                    type="button"
                    class="min-h-11 rounded-lg border py-2 text-[13px] font-medium transition-colors"
                    :class="selectedSlot === slot
                      ? 'border-primary bg-primary text-inverted'
                      : 'border-default text-toned hover:border-primary'"
                    :aria-pressed="selectedSlot === slot"
                    @click="selectedSlot = slot"
                  >
                    {{ timeLabel(slot) }}
                  </button>
                </div>
              </template>

              <p
                v-else
                class="py-16 text-center text-sm text-dimmed"
              >
                Nothing free this week.
              </p>
            </div>

            <form
              v-if="selectedSlot"
              data-testid="booking-form"
              class="mt-6 space-y-3 border-t border-default pt-6"
              @submit.prevent="confirm"
            >
              <p class="text-sm text-toned">
                <span class="font-semibold text-highlighted">{{ timeLabel(selectedSlot) }}</span>
                on {{ longSelected }}
              </p>

              <UFormField
                label="Your name"
                name="name"
              >
                <UInput
                  v-model="booking.name"
                  autocomplete="name"
                  required
                  size="lg"
                  class="min-h-11 w-full"
                />
              </UFormField>
              <UFormField
                label="Email"
                name="email"
              >
                <UInput
                  v-model="booking.email"
                  type="email"
                  autocomplete="email"
                  required
                  size="lg"
                  class="min-h-11 w-full"
                />
              </UFormField>
              <UFormField
                label="Notes"
                name="notes"
                hint="Optional"
              >
                <UTextarea
                  v-model="booking.notes"
                  :rows="3"
                  :maxlength="2000"
                  placeholder="Anything useful to know?"
                  class="w-full"
                />
              </UFormField>

              <p
                v-if="bookingError"
                class="rounded-lg border border-error/30 bg-error/10 px-3.5 py-2.5 text-[13px] text-error"
                role="alert"
              >
                {{ bookingError }}
              </p>

              <UButton
                type="submit"
                size="lg"
                block
                :loading="submitting"
                class="min-h-11 rounded-full font-medium"
              >
                {{ rescheduleOf ? 'Confirm new time' : 'Confirm booking' }}
              </UButton>
            </form>
          </div>
        </div>
      </div>
    </div>

    <footer class="px-5 pb-10 pt-6 text-center text-xs text-muted">
      Scheduling by
      <NuxtLink
        to="/"
        class="underline underline-offset-4 transition-colors hover:text-highlighted"
      >Schedra</NuxtLink>
    </footer>
  </div>
</template>
