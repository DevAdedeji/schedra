<script setup lang="ts">
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

const { data, status, error, refresh } = await useFetch('/api/availability', {
  query: { username, slug, from: isoDate(firstMonday), to: isoDate(addDays(firstMonday, 62)) }
})

const { data: page } = await useFetch(`/api/booking-page/${username}/${slug}`)

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
const submitting = ref(false)
const bookingError = ref('')
const confirmed = ref<{ start: string, uid: string } | null>(null)

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

async function confirm() {
  if (!selectedSlot.value) return

  submitting.value = true
  bookingError.value = ''

  try {
    const result = await $fetch('/api/bookings', {
      method: 'POST',
      body: {
        username,
        slug,
        start: selectedSlot.value,
        name: booking.name,
        email: booking.email,
        timeZone: viewerTimeZone.value,
        notes: booking.notes || undefined,
        rescheduleOf: rescheduleOf.value
      }
    })
    confirmed.value = { start: result.start, uid: result.uid }
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

useSeoMeta({
  title: () => page.value ? `${page.value.title} with ${page.value.hostName}` : 'Book a time',
  robots: 'noindex, nofollow'
})
</script>

<template>
  <div class="flex min-h-screen flex-col bg-muted">
    <main class="flex-1 px-5">
      <div class="mx-auto max-w-4xl">
        <div class="pt-6 pb-12">
          <NuxtLink to="/">
            <SchedraMark />
          </NuxtLink>
        </div>

        <div
          v-if="error"
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
          v-else-if="confirmed"
          class="rounded-2xl border border-default bg-default px-8 py-16 text-center"
        >
          <div class="mb-6 flex justify-center">
            <div
              class="flex items-center justify-center rounded-full bg-primary"
              style="width: 64px; height: 64px"
            >
              <UIcon
                name="i-lucide-check"
                class="size-7 text-white"
              />
            </div>
          </div>
          <h1 class="font-editorial text-4xl text-highlighted">
            You're booked.
          </h1>
          <p class="mx-auto mt-4 max-w-sm text-base leading-relaxed text-muted">
            {{ confirmedWhen }}, with {{ page?.hostName }}.
          </p>
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
                  name="i-lucide-globe"
                  class="mt-2.5 size-4 shrink-0 text-dimmed"
                />
                <USelectMenu
                  v-model="viewerTimeZone"
                  :items="zones"
                  :search-input="{ placeholder: 'Search timezones…' }"
                  aria-label="Timezone"
                  size="sm"
                  class="min-w-0 flex-1"
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
                type="button"
                class="rounded-lg py-2 text-center transition-colors"
                :class="selectedDate === isoDate(day)
                  ? 'bg-primary text-white'
                  : slotsByDate.has(isoDate(day))
                    ? 'text-highlighted hover:bg-muted'
                    : 'cursor-not-allowed text-dimmed opacity-40'"
                :disabled="!slotsByDate.has(isoDate(day))"
                @click="selectedDate = isoDate(day); selectedSlot = null"
              >
                <span class="block text-[10px] font-semibold uppercase tracking-wide opacity-70">
                  {{ new Intl.DateTimeFormat('en', { weekday: 'short' }).format(day).slice(0, 2) }}
                </span>
                <span class="tnum mt-0.5 block text-[15px] font-semibold">{{ day.getDate() }}</span>
              </button>
            </div>

            <div class="mt-6">
              <p
                v-if="status === 'pending'"
                class="py-16 text-center text-sm text-dimmed"
              >
                Loading times…
              </p>

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
                    type="button"
                    class="min-h-11 rounded-lg border py-2 text-[13px] font-medium transition-colors"
                    :class="selectedSlot === slot
                      ? 'border-primary bg-primary text-white'
                      : 'border-default text-toned hover:border-primary'"
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
                  class="w-full"
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
                  class="w-full"
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
                class="rounded-full font-medium"
              >
                Confirm booking
              </UButton>
            </form>
          </div>
        </div>
      </div>
    </main>

    <footer class="px-5 pb-10 pt-6 text-center text-xs text-dimmed">
      Scheduling by
      <NuxtLink
        to="/"
        class="underline underline-offset-4 transition-colors hover:text-muted"
      >Schedra</NuxtLink>
    </footer>
  </div>
</template>
