<script setup lang="ts">
import { teamBookingsApi, teamsApi, type TeamBookingsResponse, type TeamDetail } from '~/services/schedra-api'

definePageMeta({ layout: 'app', middleware: 'auth' })

const route = useRoute()
const slug = computed(() => String(route.params.slug ?? ''))

const { data: team } = await useLazyFetch<TeamDetail>(() => teamsApi.detailEndpoint(slug.value))
useSeoMeta({
  title: () => team.value ? `${team.value.organization.name} bookings` : 'Team bookings',
  robots: 'noindex, nofollow'
})

const filter = ref<'upcoming' | 'pending' | 'past' | 'cancelled'>('upcoming')
const query = ref('')
const search = ref('')
const page = ref(1)
const listQuery = computed(() => ({
  filter: filter.value, search: search.value, page: page.value, pageSize: 10
}))

const { data, refresh, status, error: loadFailure }
  = await useLazyFetch<TeamBookingsResponse>(() => teamBookingsApi.listEndpoint(slug.value), { query: listQuery })

const list = computed(() => data.value?.items ?? [])
const initialLoading = computed(() => status.value === 'pending' && !data.value)
const refreshing = computed(() => status.value === 'pending' && Boolean(data.value))

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
  { value: 'upcoming', label: 'Upcoming', count: data.value?.counts.upcoming ?? 0 },
  { value: 'pending', label: 'Requests', count: data.value?.counts.pending ?? 0 },
  { value: 'past', label: 'Past', count: data.value?.counts.past ?? 0 },
  { value: 'cancelled', label: 'Cancelled', count: data.value?.counts.cancelled ?? 0 }
])

const viewerTimeZone = ref('UTC')
onMounted(() => {
  viewerTimeZone.value = Intl.DateTimeFormat().resolvedOptions().timeZone
})

function when(iso: string) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: viewerTimeZone.value
  }).format(new Date(iso))
}

const statusColor: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
  confirmed: 'success', pending: 'warning', cancelled: 'neutral', rejected: 'error'
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="Team bookings"
      :description="data?.scope === 'mine'
        ? 'Meetings you are hosting for this team.'
        : 'Everything booked across this team.'"
    />

    <section class="overflow-hidden rounded-xl border border-default bg-default">
      <div class="flex flex-col gap-3 border-b border-default px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <ListFilter
          v-model="filter"
          :options="filterOptions"
          :disabled="refreshing"
        />
        <UInput
          v-model="query"
          icon="i-lucide-search"
          placeholder="Search guests"
          size="sm"
          class="sm:w-56"
        />
      </div>

      <AsyncErrorState
        v-if="loadFailure && !data"
        title="Could not load bookings"
        @retry="refresh"
      />

      <ListLoadingSkeleton
        v-else-if="initialLoading"
        variant="bookings"
        label="Loading bookings"
      />

      <ListEmptyState
        v-else-if="!list.length"
        icon="i-lucide-calendar-days"
        :title="query ? 'No matching bookings' : 'Nothing booked yet'"
        :description="query
          ? 'Try another search or change the filter.'
          : 'Share a team booking link and anything booked will appear here.'"
      />

      <ul
        v-else
        class="divide-y divide-default"
        :class="refreshing && 'opacity-60'"
      >
        <li
          v-for="booking in list"
          :key="booking.uid"
          class="flex flex-wrap items-start gap-3 px-4 py-4 sm:px-5"
        >
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <p class="truncate text-[14px] font-medium text-highlighted">
                {{ booking.eventTitle }}
              </p>
              <UBadge
                :color="statusColor[booking.status] ?? 'neutral'"
                variant="subtle"
                size="sm"
              >
                {{ booking.status }}
              </UBadge>
            </div>
            <p class="mt-1 text-[13px] text-muted">
              {{ when(booking.startsAt) }} · {{ booking.attendeeName }}
              <span class="text-dimmed">({{ booking.attendeeEmail }})</span>
            </p>
            <p
              v-if="booking.hosts.length"
              class="mt-1 text-[12px] text-muted"
            >
              Hosted by {{ booking.hosts.map(host => host.name).join(', ') }}
            </p>
            <p
              v-if="booking.cancellationReason"
              class="mt-1 text-[12px] text-muted"
            >
              {{ booking.cancellationReason }}
            </p>
          </div>

          <UButton
            color="neutral"
            variant="outline"
            size="xs"
            :to="`/booking/${booking.uid}`"
          >
            Open
          </UButton>
        </li>
      </ul>

      <ListPagination
        :page="data?.pagination.page ?? 1"
        :total-pages="data?.pagination.totalPages ?? 1"
        :total="data?.pagination.total ?? 0"
        :disabled="refreshing"
        @change="page = $event"
      />
    </section>
  </div>
</template>
