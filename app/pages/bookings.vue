<script setup lang="ts">
import type { PaginationMeta } from '#shared/pagination'

definePageMeta({ layout: 'app', middleware: 'auth' })
useSeoMeta({ title: 'Your bookings', robots: 'noindex, nofollow' })

interface BookingRecord {
  uid: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'rejected'
  startsAt: string
  endsAt: string
  attendeeName: string
  attendeeEmail: string
  attendeeTimeZone: string
  eventTitle: string
  notes: string | null
  cancellationReason: string | null
}

interface BookingsResponse {
  items: BookingRecord[]
  pagination: PaginationMeta
  counts: { all: number, upcoming: number, past: number, cancelled: number, nextWeek: number }
}

const filter = ref<'all' | 'upcoming' | 'past' | 'cancelled'>('upcoming')
const query = ref('')
const search = ref('')
const page = ref(1)
const apiQuery = computed(() => ({ filter: filter.value, search: search.value, page: page.value, pageSize: 10 }))
const { data, refresh, status } = await useFetch<BookingsResponse>('/api/bookings', { query: apiQuery })
const list = computed(() => data.value?.items ?? [])

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(query, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    search.value = value.trim()
    page.value = 1
  }, 250)
})
watch(filter, () => {
  page.value = 1
})
onBeforeUnmount(() => clearTimeout(searchTimer))

const filterOptions = computed(() => [
  { value: 'all', label: 'All', count: data.value?.counts.all ?? 0 },
  { value: 'upcoming', label: 'Upcoming', count: data.value?.counts.upcoming ?? 0 },
  { value: 'past', label: 'Past', count: data.value?.counts.past ?? 0 },
  { value: 'cancelled', label: 'Cancelled', count: data.value?.counts.cancelled ?? 0 }
])

const emptyTitle = computed(() => query.value
  ? 'No matching bookings'
  : filter.value === 'upcoming'
    ? 'Nothing booked yet'
    : filter.value === 'cancelled'
      ? 'No cancelled bookings'
      : 'Nothing here yet')
const emptyDescription = computed(() => query.value
  ? 'Try another search or change the filter.'
  : filter.value === 'upcoming'
    ? 'Share your booking link and anything people book will appear here.'
    : 'Bookings in this view will collect here.')

const viewerTimeZone = ref('UTC')
onMounted(() => {
  viewerTimeZone.value = Intl.DateTimeFormat().resolvedOptions().timeZone
})

function dayKey(iso: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: viewerTimeZone.value }).format(new Date(iso))
}

function dayHeading(iso: string) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: viewerTimeZone.value
  }).format(new Date(iso))
}

const grouped = computed(() => {
  const map = new Map<string, { heading: string, items: typeof list.value }>()
  for (const item of list.value) {
    const key = dayKey(item.startsAt)
    const entry = map.get(key) ?? { heading: dayHeading(item.startsAt), items: [] }
    entry.items.push(item)
    map.set(key, entry)
  }
  return [...map.values()]
})

function initials(name: string) {
  return name.split(' ').map(part => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}

function time(iso: string) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: viewerTimeZone.value
  }).format(new Date(iso))
}

function isUpcoming(item: BookingRecord) {
  return item.status !== 'cancelled' && new Date(item.endsAt) >= new Date()
}

const cancelling = ref<string | null>(null)

async function cancel(uid: string) {
  cancelling.value = uid
  try {
    await $fetch(`/api/booking/${uid}/cancel`, { method: 'POST', body: {} })
    await refresh()
  } finally {
    cancelling.value = null
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="Bookings"
      description="Everything people have booked with you."
    />

    <section class="mt-7 overflow-hidden rounded-xl border border-default bg-default">
      <div class="flex flex-col gap-3 border-b border-default px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <ListFilter
          v-model="filter"
          :options="filterOptions"
        />
        <UInput
          v-model="query"
          icon="i-lucide-search"
          placeholder="Search bookings"
          aria-label="Search bookings"
          class="w-full sm:w-64"
        >
          <template
            v-if="query"
            #trailing
          >
            <UButton
              color="neutral"
              variant="link"
              icon="i-lucide-x"
              size="xs"
              aria-label="Clear search"
              @click="query = ''"
            />
          </template>
        </UInput>
      </div>

      <div
        v-if="status === 'pending'"
        class="space-y-3 p-5"
      >
        <USkeleton
          v-for="index in 3"
          :key="index"
          class="h-28 w-full rounded-xl"
        />
      </div>

      <div
        v-else-if="grouped.length"
        class="space-y-7 p-5 sm:p-6"
      >
        <section
          v-for="group in grouped"
          :key="group.heading"
        >
          <h2 class="text-[12px] font-semibold uppercase tracking-[0.1em] text-dimmed">
            {{ group.heading }}
          </h2>

          <ul class="mt-3 space-y-2.5">
            <li
              v-for="item in group.items"
              :key="item.uid"
              class="rounded-xl border border-default bg-default p-5"
              :class="item.status === 'cancelled' && 'opacity-60'"
            >
              <div class="flex flex-wrap items-start gap-4">
                <span class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[13px] font-semibold text-primary">
                  {{ initials(item.attendeeName) }}
                </span>

                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="tnum text-[15px] font-semibold text-highlighted">
                      {{ time(item.startsAt) }}–{{ time(item.endsAt) }}
                    </span>
                    <span
                      v-if="item.status === 'cancelled'"
                      class="rounded-full bg-elevated px-2.5 py-0.5 text-[11px] font-medium text-muted"
                    >
                      Cancelled
                    </span>
                  </div>

                  <p class="mt-1 text-[14px] text-toned">
                    {{ item.eventTitle }}
                  </p>
                  <p class="mt-0.5 truncate text-[13px] text-muted">
                    {{ item.attendeeName }} · {{ item.attendeeEmail }}
                  </p>

                  <p
                    v-if="item.notes"
                    class="mt-3 rounded-lg border border-default bg-muted px-3.5 py-2.5 text-[13px] leading-relaxed text-muted"
                  >
                    {{ item.notes }}
                  </p>
                </div>

                <div class="flex shrink-0 gap-2">
                  <UButton
                    :to="`/booking/${item.uid}`"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    class="font-medium"
                  >
                    Open
                  </UButton>
                  <UButton
                    v-if="isUpcoming(item) && item.status !== 'cancelled'"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :loading="cancelling === item.uid"
                    class="font-medium"
                    @click="cancel(item.uid)"
                  >
                    Cancel
                  </UButton>
                </div>
              </div>
            </li>
          </ul>
        </section>
      </div>

      <ListEmptyState
        v-else
        icon="i-lucide-calendar-days"
        :title="emptyTitle"
        :description="emptyDescription"
      >
        <template
          v-if="filter === 'upcoming' && !query"
          #action
        >
          <UButton
            to="/dashboard"
            class="font-medium"
          >
            Get your link
          </UButton>
        </template>
      </ListEmptyState>

      <ListPagination
        v-if="status !== 'pending' && data"
        :page="data.pagination.page"
        :total-pages="data.pagination.totalPages"
        :total="data.pagination.total"
        @change="page = $event"
      />
    </section>
  </div>
</template>
