<script setup lang="ts">
import { apiErrorMessage, bookingsApi, type BookingRecord, type BookingsResponse } from '~/services/schedra-api'
import { DEFAULT_LIST_PAGE_SIZE } from '~/constants/lists'
import { calendarDateKey, formatInstant, formatTime, isPast, localTimeZone } from '~/utils/date-time'
import { getInitials } from '~/utils/text'

definePageMeta({ layout: 'app', middleware: 'auth' })
useSeoMeta({ title: 'Your bookings', robots: 'noindex, nofollow' })

const filter = ref<'all' | 'upcoming' | 'pending' | 'past' | 'cancelled'>('upcoming')
const { query, search, page, resetPage } = useListQueryState()
const apiQuery = computed(() => ({ filter: filter.value, search: search.value, page: page.value, pageSize: DEFAULT_LIST_PAGE_SIZE }))
const { data, refresh, status, error: loadFailure } = await useLazyFetch<BookingsResponse>(bookingsApi.listEndpoint, { query: apiQuery })
const feedback = useFeedback()
const list = computed(() => data.value?.items ?? [])
const { initialLoading, refreshing, blockingFailure } = useListLoadingState(status, data, loadFailure)

watch(filter, resetPage)

const filterOptions = computed(() => [
  { value: 'all', label: 'All', count: data.value?.counts.all ?? 0 },
  { value: 'upcoming', label: 'Upcoming', count: data.value?.counts.upcoming ?? 0 },
  { value: 'pending', label: 'Requests', count: data.value?.counts.pending ?? 0 },
  { value: 'past', label: 'Past', count: data.value?.counts.past ?? 0 },
  { value: 'cancelled', label: 'Cancelled', count: data.value?.counts.cancelled ?? 0 }
])

const emptyTitle = computed(() => query.value
  ? 'No matching bookings'
  : filter.value === 'upcoming'
    ? 'Nothing booked yet'
    : filter.value === 'pending'
      ? 'No booking requests'
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
  viewerTimeZone.value = localTimeZone()
})

function dayKey(iso: string) {
  return calendarDateKey(iso, viewerTimeZone.value)
}

function dayHeading(iso: string) {
  return formatInstant(iso, {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: viewerTimeZone.value
  }, 'en-GB')
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

function time(iso: string) {
  return formatTime(iso, viewerTimeZone.value)
}

function isUpcoming(item: BookingRecord) {
  return item.status !== 'cancelled' && !isPast(item.endsAt)
}

function locationLabel(item: BookingRecord) {
  if (item.locationType === 'google_meet') return 'Google Meet'
  if (item.locationType === 'zoom') return 'Zoom'
  if (item.locationType === 'video_link') return 'Video call'
  if (item.locationType === 'phone') return 'Phone call'
  if (item.locationType === 'in_person') return 'In person'
  return 'Meeting details'
}

function locationIcon(item: BookingRecord) {
  if (item.locationType === 'google_meet') return 'i-simple-icons-googlemeet'
  if (item.locationType === 'zoom') return 'i-simple-icons-zoom'
  if (item.locationType === 'in_person') return 'i-lucide-map-pin'
  if (item.locationType === 'phone') return 'i-lucide-phone'
  return 'i-lucide-video'
}

const cancelling = ref<string | null>(null)
const approving = ref<string | null>(null)
const rejecting = ref<string | null>(null)
const actionError = ref('')

async function cancel(uid: string) {
  cancelling.value = uid
  actionError.value = ''
  try {
    await bookingsApi.cancel(uid)
    await refresh()
    feedback.success({ title: 'Booking cancelled', description: 'The guest and connected calendar will be updated.' })
  } catch (failure) {
    actionError.value = apiErrorMessage(failure, 'Could not cancel this booking just now. Please try again.')
  } finally {
    cancelling.value = null
  }
}

async function approve(uid: string) {
  approving.value = uid
  actionError.value = ''
  try {
    await bookingsApi.approve(uid)
    await refresh()
    feedback.success({ title: 'Booking approved', description: 'The guests have been notified and your calendar will be updated.' })
  } catch (failure) {
    actionError.value = apiErrorMessage(failure, 'Could not approve this request. Please try again.')
  } finally {
    approving.value = null
  }
}

async function reject(uid: string) {
  rejecting.value = uid
  actionError.value = ''
  try {
    await bookingsApi.reject(uid)
    await refresh()
    feedback.success({ title: 'Request declined', description: 'The guests have been notified and the time is available again.' })
  } catch (failure) {
    actionError.value = apiErrorMessage(failure, 'Could not decline this request. Please try again.')
  } finally {
    rejecting.value = null
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="Bookings"
      description="Everything people have booked with you."
    />

    <p
      v-if="actionError"
      class="mt-7 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-[14px] text-error"
      role="alert"
    >
      {{ actionError }}
    </p>

    <section
      class="overflow-hidden rounded-xl border border-default bg-default"
      :class="actionError ? 'mt-4' : 'mt-7'"
    >
      <div class="surface-secondary flex flex-col gap-3 border-b border-default px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <ListFilter
          v-model="filter"
          :options="filterOptions"
          :disabled="initialLoading || refreshing"
        />
        <UInput
          v-model="query"
          icon="i-lucide-search"
          placeholder="Search bookings"
          aria-label="Search bookings"
          class="w-full sm:w-64"
          :disabled="initialLoading"
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

      <ListLoadingSkeleton
        v-if="initialLoading"
        variant="bookings"
        :rows="3"
        label="Loading bookings"
      />

      <AsyncErrorState
        v-else-if="blockingFailure"
        title="Could not load bookings"
        description="Your bookings are safe. Check your connection and try loading them again."
        :retrying="status === 'pending'"
        @retry="refresh"
      />

      <template v-else>
        <AsyncErrorState
          v-if="loadFailure"
          compact
          class="border-b border-default bg-error/5"
          title="Could not refresh bookings"
          description="The last loaded results are still shown below."
          :retrying="refreshing"
          @retry="refresh"
        />

        <div
          v-else-if="refreshing"
          class="surface-secondary flex items-center gap-2 border-b border-default px-4 py-2 text-[12px] text-muted sm:px-5"
          role="status"
          aria-live="polite"
        >
          <UIcon
            name="i-lucide-loader-circle"
            class="size-3.5 animate-spin text-primary"
          />
          Updating bookings…
        </div>

        <div
          v-if="grouped.length"
          class="space-y-7 p-5 sm:p-6"
        >
          <section
            v-for="group in grouped"
            :key="group.heading"
          >
            <h2 class="text-[13px] font-semibold uppercase tracking-[0.1em] text-dimmed">
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
                  <span class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[14px] font-semibold text-primary">
                    {{ getInitials(item.attendeeName) }}
                  </span>

                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="tnum text-[16px] font-semibold text-highlighted">
                        {{ time(item.startsAt) }}–{{ time(item.endsAt) }}
                      </span>
                      <span
                        v-if="item.status === 'cancelled'"
                        class="rounded-full bg-elevated px-2.5 py-0.5 text-[12px] font-medium text-muted"
                      >
                        Cancelled
                      </span>
                      <span
                        v-else-if="item.status === 'pending'"
                        class="rounded-full bg-warning/10 px-2.5 py-0.5 text-[12px] font-medium text-warning"
                      >
                        Needs approval
                      </span>
                      <span
                        v-else-if="item.status === 'rejected'"
                        class="rounded-full bg-elevated px-2.5 py-0.5 text-[12px] font-medium text-muted"
                      >
                        Declined
                      </span>
                    </div>

                    <p class="mt-1 text-[15px] text-toned">
                      {{ item.eventTitle }}
                    </p>
                    <p class="mt-0.5 truncate text-[14px] text-muted">
                      {{ item.attendeeName }} · {{ item.attendeeEmail }}
                    </p>
                    <p
                      v-if="item.additionalGuestEmails.length"
                      class="mt-0.5 text-[13px] text-dimmed"
                    >
                      + {{ item.additionalGuestEmails.length }} additional guest{{ item.additionalGuestEmails.length === 1 ? '' : 's' }}
                    </p>
                    <p class="mt-1.5 flex items-center gap-1.5 text-[13px] text-muted">
                      <UIcon
                        :name="locationIcon(item)"
                        class="size-3.5 shrink-0 text-dimmed"
                      />
                      <span class="truncate">{{ locationLabel(item) }}<template v-if="item.locationType === 'in_person'"> · {{ item.locationDetails }}</template></span>
                    </p>

                    <p
                      v-if="item.notes"
                      class="mt-3 rounded-lg border border-default bg-muted px-3.5 py-2.5 text-[14px] leading-relaxed text-muted"
                    >
                      {{ item.notes }}
                    </p>
                  </div>

                  <div class="flex shrink-0 gap-2">
                    <UButton
                      v-if="item.status === 'pending' && isUpcoming(item)"
                      size="sm"
                      :loading="approving === item.uid"
                      class="font-medium"
                      @click="approve(item.uid)"
                    >
                      Approve
                    </UButton>
                    <UButton
                      v-if="item.status === 'pending' && isUpcoming(item)"
                      color="error"
                      variant="ghost"
                      size="sm"
                      :loading="rejecting === item.uid"
                      class="font-medium"
                      @click="reject(item.uid)"
                    >
                      Decline
                    </UButton>
                    <UButton
                      v-if="isUpcoming(item) && item.status === 'confirmed' && item.meetingUrl"
                      :to="item.meetingUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      color="neutral"
                      variant="outline"
                      size="sm"
                      trailing-icon="i-lucide-external-link"
                      class="font-medium"
                    >
                      Join
                    </UButton>
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
                      v-if="isUpcoming(item) && !['cancelled', 'rejected'].includes(item.status)"
                      color="error"
                      variant="soft"
                      size="sm"
                      icon="i-lucide-calendar-x-2"
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
          v-if="data"
          :page="data.pagination.page"
          :total-pages="data.pagination.totalPages"
          :total="data.pagination.total"
          :page-size="data.pagination.pageSize"
          :disabled="refreshing"
          @change="page = $event"
        />
      </template>
    </section>
  </div>
</template>
