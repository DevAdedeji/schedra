<script setup lang="ts">
import { bookingsApi, eventTypesApi, schedulesApi, type BookingsResponse, type EventTypesResponse, type SchedulesResponse } from '~/services/schedra-api'

definePageMeta({ layout: 'app', middleware: 'auth' })
useSeoMeta({ title: 'Overview', robots: 'noindex, nofollow' })

const currentUserRequest = useCurrentUser()
const bookingsRequest = useLazyFetch<BookingsResponse>(bookingsApi.listEndpoint, {
  query: { filter: 'upcoming', pageSize: 3 }
})
const eventTypesRequest = useLazyFetch<EventTypesResponse>(eventTypesApi.listEndpoint, { query: { pageSize: 1 } })
const schedulesRequest = useLazyFetch<SchedulesResponse>(schedulesApi.listEndpoint, { query: { pageSize: 10 } })
const [
  { data },
  { data: bookings, status: bookingsStatus, error: bookingsFailure, refresh: refreshBookings },
  { data: eventTypes, status: eventTypesStatus, error: eventTypesFailure, refresh: refreshEventTypes },
  { data: schedules, status: schedulesStatus, error: schedulesFailure, refresh: refreshSchedules }
] = await Promise.all([currentUserRequest, bookingsRequest, eventTypesRequest, schedulesRequest])
const { url, host } = useSiteUrl()
const { copied, copy } = useCopy()
const feedback = useFeedback()

const user = computed(() => data.value?.user)
const link = computed(() => `${host.value}/${user.value?.username ?? ''}`)
const nextBookings = computed(() => bookings.value?.items ?? [])
const activeEventTypeCount = computed(() => eventTypes.value?.counts.active ?? 0)
const schedule = computed(() => schedules.value?.items.find(item => item.isDefault) ?? schedules.value?.items[0])
const overviewReady = computed(() => Boolean(bookings.value && eventTypes.value && schedules.value))
const overviewFailure = computed(() => bookingsFailure.value ?? eventTypesFailure.value ?? schedulesFailure.value)
const overviewLoading = computed(() => !overviewReady.value && !overviewFailure.value)
const overviewRefreshing = computed(() => overviewReady.value && [bookingsStatus.value, eventTypesStatus.value, schedulesStatus.value].includes('pending'))
const overviewRetrying = computed(() => [bookingsStatus.value, eventTypesStatus.value, schedulesStatus.value].includes('pending'))

async function retryOverview() {
  await Promise.allSettled([refreshBookings(), refreshEventTypes(), refreshSchedules()])
}

const stats = computed(() => [
  { label: 'Upcoming', value: bookings.value?.counts.upcoming ?? 0, icon: 'i-lucide-calendar-clock', hint: 'Scheduled meetings' },
  { label: 'Next 7 days', value: bookings.value?.counts.nextWeek ?? 0, icon: 'i-lucide-calendar-range', hint: 'On your near-term calendar' },
  { label: 'Active links', value: activeEventTypeCount.value, icon: 'i-lucide-link-2', hint: 'Ready to share' },
  { label: 'Cancelled', value: bookings.value?.counts.cancelled ?? 0, icon: 'i-lucide-calendar-x-2', hint: 'Across your history' }
])

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const scheduleDays = computed(() => weekdays.map((label, index) => {
  const rules = schedule.value?.rules.filter(rule => rule.weekday === index + 1) ?? []
  return { label, rules }
}))
const viewerTimeZone = ref('UTC')
onMounted(() => {
  viewerTimeZone.value = Intl.DateTimeFormat().resolvedOptions().timeZone
})

function when(iso: string) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: viewerTimeZone.value
  }).format(new Date(iso))
}

function initials(name: string) {
  return name.split(' ').map(part => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}

async function copyBookingPage() {
  const written = await copy(`${url.value}/${user.value?.username ?? ''}`)
  if (written) feedback.success({ title: 'Booking link copied' })
  else feedback.error({ title: 'Could not copy booking link' })
}
</script>

<template>
  <div class="space-y-7">
    <PageHeader
      :title="`Hello, ${user?.name?.split(' ')[0] ?? ''}`"
      description="Everything you have scheduled, at a glance."
    >
      <template #actions>
        <UButton
          :to="`/${user?.username}`"
          target="_blank"
          rel="noopener noreferrer"
          color="neutral"
          variant="outline"
          trailing-icon="i-lucide-external-link"
          class="font-medium"
        >
          View booking page
        </UButton>
      </template>
    </PageHeader>

    <OverviewLoadingSkeleton v-if="overviewLoading" />

    <section
      v-else-if="overviewFailure && !overviewReady"
      class="overflow-hidden rounded-xl border border-default bg-default"
    >
      <AsyncErrorState
        title="Could not load your overview"
        description="Your scheduling data is safe. Check your connection and try loading your overview again."
        :retrying="overviewRetrying"
        @retry="retryOverview"
      />
    </section>

    <template v-else>
      <AsyncErrorState
        v-if="overviewFailure"
        compact
        class="rounded-xl border border-error/20 bg-error/5"
        title="Could not refresh the overview"
        description="The last loaded information is still shown below."
        :retrying="overviewRetrying"
        @retry="retryOverview"
      />

      <div
        v-else-if="overviewRefreshing"
        class="flex items-center gap-2 rounded-lg border border-default bg-default px-4 py-2 text-[12px] text-muted"
        role="status"
        aria-live="polite"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-3.5 animate-spin text-primary"
        />
        Refreshing your overview…
      </div>

      <section class="grid overflow-hidden rounded-xl border border-default bg-default lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div class="px-5 py-6 sm:px-6">
          <p class="text-[12px] font-semibold uppercase tracking-[0.1em] text-dimmed">
            Your booking link
          </p>
          <h2 class="mt-2 text-[18px] font-semibold text-highlighted">
            Ready when you are.
          </h2>
          <p class="mt-1 max-w-xl text-[14px] leading-relaxed text-muted">
            Share one link and let guests choose from every active event type.
          </p>
          <button
            type="button"
            class="mt-5 flex w-full max-w-2xl items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-colors"
            :class="copied ? 'border-success/30 bg-success/10' : 'border-default bg-muted hover:border-primary'"
            :aria-label="`Copy ${link}`"
            @click="copyBookingPage"
          >
            <span
              class="flex size-8 shrink-0 items-center justify-center rounded-lg"
              :class="copied ? 'bg-success/15 text-success' : 'bg-primary/10 text-primary'"
            ><UIcon
              :name="copied ? 'i-lucide-check' : 'i-lucide-link'"
              class="size-4"
            /></span>
            <span class="min-w-0 flex-1 truncate text-[15px] font-medium text-highlighted">{{ link }}</span>
            <span
              class="flex items-center gap-1.5 text-[13px]"
              :class="copied ? 'text-success' : 'text-muted'"
            ><UIcon
              :name="copied ? 'i-lucide-check' : 'i-lucide-copy'"
              class="size-4"
            />{{ copied ? 'Copied' : 'Copy' }}</span>
          </button>
        </div>
        <div class="surface-secondary border-t border-default px-5 py-5 lg:border-l lg:border-t-0">
          <span
            class="flex size-9 items-center justify-center rounded-lg"
            :class="activeEventTypeCount ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'"
          ><UIcon
            :name="activeEventTypeCount ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'"
            class="size-4.5"
          /></span>
          <p class="mt-3 text-[14px] font-semibold text-highlighted">
            {{ activeEventTypeCount ? 'Booking page is live' : 'No active booking links' }}
          </p>
          <p class="mt-1 text-[12px] leading-relaxed text-muted">
            {{ activeEventTypeCount
              ? `${activeEventTypeCount} active ${activeEventTypeCount === 1 ? 'event type is' : 'event types are'} ready to share.`
              : 'Create an event type or make a hidden one active before sharing your page.' }}
          </p>
          <UButton
            to="/event-types"
            color="neutral"
            variant="outline"
            size="sm"
            trailing-icon="i-lucide-arrow-right"
            class="mt-4"
          >
            Manage event types
          </UButton>
        </div>
      </section>

      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div
          v-for="stat in stats"
          :key="stat.label"
          class="rounded-xl border border-default bg-default px-4 py-4 sm:px-5"
        >
          <div class="flex items-center justify-between gap-3">
            <p class="text-[13px] font-medium text-muted">
              {{ stat.label }}
            </p><UIcon
              :name="stat.icon"
              class="size-4 text-dimmed"
            />
          </div>
          <p class="tnum mt-3 text-[27px] font-semibold leading-none text-highlighted">
            {{ stat.value }}
          </p>
          <p class="mt-2 hidden text-[12px] text-dimmed sm:block">
            {{ stat.hint }}
          </p>
        </div>
      </div>

      <div class="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section class="overflow-hidden rounded-xl border border-default bg-default">
          <div class="flex items-center justify-between gap-4 border-b border-default px-5 py-4">
            <div>
              <h2 class="text-[16px] font-semibold text-highlighted">
                Next up
              </h2><p class="mt-0.5 text-[13px] text-muted">
                The meetings that need your attention first.
              </p>
            </div>
            <UButton
              to="/bookings"
              color="neutral"
              variant="ghost"
              size="sm"
              trailing-icon="i-lucide-arrow-right"
            >
              All bookings
            </UButton>
          </div>
          <ul
            v-if="nextBookings.length"
            class="divide-y divide-default"
          >
            <li
              v-for="booking in nextBookings"
              :key="booking.uid"
            >
              <NuxtLink
                :to="`/booking/${booking.uid}`"
                class="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted"
              >
                <span class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[13px] font-semibold text-primary">{{ initials(booking.attendeeName) }}</span>
                <div class="min-w-0 flex-1"><p class="truncate text-[15px] font-semibold text-highlighted">{{ booking.eventTitle }}</p><p class="mt-0.5 truncate text-[13px] text-muted">{{ booking.attendeeName }} · {{ when(booking.startsAt) }}</p></div>
                <UIcon
                  name="i-lucide-chevron-right"
                  class="size-4 shrink-0 text-dimmed"
                />
              </NuxtLink>
            </li>
          </ul>
          <ListEmptyState
            v-else
            icon="i-lucide-calendar-plus"
            title="Your calendar is clear"
            description="Share your booking link or preview the guest experience before you send it."
          >
            <template #action>
              <UButton
                :to="`/${user?.username}`"
                target="_blank"
                rel="noopener noreferrer"
                color="neutral"
                variant="outline"
                trailing-icon="i-lucide-external-link"
              >
                Preview your page
              </UButton>
            </template>
          </ListEmptyState>
        </section>

        <div class="space-y-5">
          <section class="overflow-hidden rounded-xl border border-default bg-default">
            <div class="flex items-center justify-between border-b border-default px-5 py-4">
              <div>
                <h2 class="text-[15px] font-semibold text-highlighted">
                  Weekly availability
                </h2><p class="mt-0.5 text-[12px] text-muted">
                  {{ schedule?.name }} · {{ schedule?.timeZone?.replace(/_/g, ' ') }}
                </p>
              </div><UButton
                to="/availability"
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-square-pen"
                class="size-7 justify-center p-0"
                :ui="{ leadingIcon: 'size-4' }"
                aria-label="Edit availability"
              />
            </div>
            <div class="grid grid-cols-7 gap-1 px-4 py-5">
              <div
                v-for="day in scheduleDays"
                :key="day.label"
                class="text-center"
              >
                <span class="text-[12px] font-semibold uppercase tracking-wide text-dimmed">{{ day.label }}</span><span
                  class="mx-auto mt-2 flex size-8 items-center justify-center rounded-lg text-[12px] font-medium"
                  :class="day.rules.length ? 'bg-primary/10 text-primary' : 'bg-muted text-dimmed'"
                >{{ day.rules.length ? day.rules.length : '—' }}</span>
              </div>
            </div>
            <p class="surface-secondary border-t border-default px-4 py-3 text-[12px] leading-relaxed text-muted">
              Numbers show how many availability windows are open each day.
            </p>
          </section>

          <section class="rounded-xl border border-default bg-default p-5">
            <h2 class="text-[15px] font-semibold text-highlighted">
              Quick actions
            </h2>
            <div class="mt-3 grid gap-2">
              <NuxtLink
                to="/event-types?create=1"
                class="flex items-center gap-3 rounded-lg border border-default px-3.5 py-3 text-[14px] font-medium text-highlighted transition-colors hover:border-primary/40 hover:bg-muted"
              ><UIcon
                name="i-lucide-plus"
                class="size-4 text-primary"
              />New event type<UIcon
                name="i-lucide-chevron-right"
                class="ml-auto size-4 text-dimmed"
              /></NuxtLink>
              <NuxtLink
                to="/availability"
                class="flex items-center gap-3 rounded-lg border border-default px-3.5 py-3 text-[14px] font-medium text-highlighted transition-colors hover:border-primary/40 hover:bg-muted"
              ><UIcon
                name="i-lucide-calendar-range"
                class="size-4 text-primary"
              />Adjust availability<UIcon
                name="i-lucide-chevron-right"
                class="ml-auto size-4 text-dimmed"
              /></NuxtLink>
            </div>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>
