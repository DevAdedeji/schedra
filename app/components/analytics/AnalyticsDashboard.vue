<script setup lang="ts">
import { formatMoney } from '#shared/payments'
import { analyticsApi, type AnalyticsResponse } from '~/services/schedra-api'
import { formatCalendarDate } from '~/utils/date-time'

const props = withDefaults(defineProps<{ teamSlug?: string, personalPro?: boolean }>(), { personalPro: false })
const days = ref<7 | 30 | 90>(30)
const eventTypeId = ref('')
const { data, status, error, refresh } = await useLazyFetch<AnalyticsResponse>(
  () => analyticsApi.endpoint(props.teamSlug),
  { query: computed(() => ({ days: days.value, eventTypeId: eventTypeId.value || undefined })) }
)

const { initialLoading, refreshing } = useListLoadingState(status, data)
const maxDaily = computed(() => Math.max(1, ...((data.value?.daily ?? []).map(item => item.value))))
const sourceTotal = computed(() => (data.value?.sources.hosted ?? 0) + (data.value?.sources.embed ?? 0))
const options = computed(() => [
  { label: 'All event types', value: '' },
  ...((data.value?.options ?? []).map(item => ({ label: item.title, value: item.id })))
])
const exportUrl = computed(() => `/api/analytics/export?days=${days.value}${eventTypeId.value ? `&eventTypeId=${encodeURIComponent(eventTypeId.value)}` : ''}`)
const canUseAdvancedAnalytics = computed(() => Boolean(props.teamSlug || props.personalPro))

function changeLabel(value: number | null) {
  if (value === null) return 'New activity'
  if (value === 0) return 'No change'
  return `${value > 0 ? '+' : ''}${value}% vs previous period`
}

function leadTime(hours: number) {
  if (hours < 1) return `${Math.round(hours * 60)} min`
  if (hours < 48) return `${Math.round(hours * 10) / 10} hr`
  return `${Math.round(hours / 24 * 10) / 10} days`
}

function shortDate(value: string) {
  return formatCalendarDate(value, { month: 'short', day: 'numeric' }, 'en')
}

function sourcePercentage(value: number) {
  return sourceTotal.value ? Math.round(value / sourceTotal.value * 100) : 0
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="Booking analytics"
      description="See what gets booked, where guests come from and which event types perform best."
    >
      <template #actions>
        <div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <UButton
            v-if="!teamSlug && personalPro"
            :to="exportUrl"
            external
            color="neutral"
            variant="outline"
            icon="i-lucide-download"
          >
            Export CSV
          </UButton>
          <div
            class="flex rounded-lg border border-default bg-default p-1"
            aria-label="Analytics period"
          >
            <button
              v-for="option in [7, 30, 90] as const"
              :key="option"
              type="button"
              class="rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors"
              :class="days === option ? 'bg-elevated text-highlighted shadow-sm' : 'text-muted hover:text-highlighted'"
              :aria-pressed="days === option"
              @click="days = option"
            >
              {{ option }} days
            </button>
          </div>
          <USelectMenu
            v-model="eventTypeId"
            :items="options"
            value-key="value"
            aria-label="Filter by event type"
            class="w-full sm:w-48"
          />
        </div>
      </template>
    </PageHeader>

    <AsyncErrorState
      v-if="error && !data"
      title="Could not load booking analytics"
      description="Your booking data is safe. Check your connection and try again."
      @retry="refresh"
    />
    <div
      v-else-if="initialLoading"
      class="space-y-5"
      aria-label="Loading booking analytics"
    >
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <USkeleton
          v-for="index in 4"
          :key="index"
          class="h-32 rounded-xl"
        />
      </div>
      <USkeleton class="h-80 rounded-xl" />
    </div>
    <template v-else-if="data">
      <p
        v-if="data.scope === 'mine'"
        class="rounded-xl border border-default bg-default px-4 py-3 text-[13px] text-muted"
      >
        You are seeing meetings assigned to you. Team owners and admins can see the whole workspace.
      </p>

      <section
        class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        :class="refreshing && 'opacity-60'"
      >
        <article class="rounded-xl border border-default bg-default p-5">
          <div class="flex items-center justify-between">
            <p class="text-[13px] font-medium text-muted">
              Total bookings
            </p>
            <UIcon
              name="i-lucide-calendar-check-2"
              class="size-4 text-primary"
            />
          </div>
          <p class="mt-4 text-3xl font-semibold tracking-tight text-highlighted">
            {{ data.summary.total }}
          </p>
          <p class="mt-2 text-[12px] text-dimmed">
            {{ changeLabel(data.summary.totalChange) }}
          </p>
        </article>
        <article class="rounded-xl border border-default bg-default p-5">
          <div class="flex items-center justify-between">
            <p class="text-[13px] font-medium text-muted">
              Confirmed
            </p>
            <UIcon
              name="i-lucide-circle-check"
              class="size-4 text-success"
            />
          </div>
          <p class="mt-4 text-3xl font-semibold tracking-tight text-highlighted">
            {{ data.summary.confirmed }}
          </p>
          <p class="mt-2 text-[12px] text-dimmed">
            {{ changeLabel(data.summary.confirmedChange) }}
          </p>
        </article>
        <article class="rounded-xl border border-default bg-default p-5">
          <div class="flex items-center justify-between">
            <p class="text-[13px] font-medium text-muted">
              Cancellation rate
            </p>
            <UIcon
              name="i-lucide-calendar-x-2"
              class="size-4 text-warning"
            />
          </div>
          <p class="mt-4 text-3xl font-semibold tracking-tight text-highlighted">
            {{ data.summary.cancellationRate }}%
          </p>
          <p class="mt-2 text-[12px] text-dimmed">
            {{ data.summary.cancelled }} cancelled or declined
          </p>
        </article>
        <article class="rounded-xl border border-default bg-default p-5">
          <div class="flex items-center justify-between">
            <p class="text-[13px] font-medium text-muted">
              Average booking notice
            </p>
            <UIcon
              name="i-lucide-clock-3"
              class="size-4 text-primary"
            />
          </div>
          <p class="mt-4 text-3xl font-semibold tracking-tight text-highlighted">
            {{ leadTime(data.summary.averageLeadHours) }}
          </p>
          <p class="mt-2 text-[12px] text-dimmed">
            Time between booking and meeting
          </p>
        </article>
      </section>

      <section
        class="overflow-hidden rounded-xl border border-default bg-default"
        :class="refreshing && 'opacity-60'"
      >
        <header class="flex flex-wrap items-start justify-between gap-4 border-b border-default px-5 py-4">
          <div>
            <h2 class="text-[15px] font-semibold text-highlighted">
              Bookings over time
            </h2>
            <p class="mt-1 text-[12px] text-muted">
              Created bookings, shown in UTC.
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <UBadge
              color="neutral"
              variant="subtle"
            >
              {{ data.summary.completed }} completed
            </UBadge>
            <UBadge
              color="neutral"
              variant="subtle"
            >
              {{ data.summary.pending }} awaiting approval
            </UBadge>
          </div>
        </header>
        <div
          v-if="!data.summary.total"
          class="flex min-h-64 flex-col items-center justify-center px-5 text-center"
        >
          <span class="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><UIcon
            name="i-lucide-chart-no-axes-combined"
            class="size-4"
          /></span>
          <h3 class="mt-4 text-[15px] font-semibold text-highlighted">
            No bookings in this period
          </h3>
          <p class="mt-1 max-w-sm text-[13px] text-muted">
            Try a longer date range or choose all event types.
          </p>
        </div>
        <div
          v-else
          class="overflow-x-auto px-5 pb-5 pt-7"
        >
          <div
            class="flex h-56 min-w-[44rem] items-end gap-1.5 border-b border-default"
            :style="{ minWidth: `${Math.max(704, data.daily.length * 14)}px` }"
          >
            <div
              v-for="item in data.daily"
              :key="item.date"
              class="group relative flex h-full min-w-2 flex-1 items-end"
              :title="`${shortDate(item.date)}: ${item.value} bookings`"
            >
              <span
                class="w-full rounded-t-sm bg-primary/70 transition-colors group-hover:bg-primary"
                :style="{ height: `${Math.max(item.value ? 4 : 1, item.value / maxDaily * 100)}%` }"
              />
              <span class="sr-only">{{ shortDate(item.date) }}: {{ item.value }} bookings</span>
            </div>
          </div>
          <div
            class="mt-2 flex min-w-[44rem] justify-between text-[12px] text-dimmed"
            :style="{ minWidth: `${Math.max(704, data.daily.length * 14)}px` }"
          >
            <span>{{ shortDate(data.daily[0]!.date) }}</span>
            <span>{{ shortDate(data.daily[data.daily.length - 1]!.date) }}</span>
          </div>
        </div>
      </section>

      <div class="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <section class="rounded-xl border border-default bg-default p-5">
          <h2 class="text-[15px] font-semibold text-highlighted">
            Where guests book
          </h2>
          <p class="mt-1 text-[12px] text-muted">
            Hosted pages compared with your website embed.
          </p>
          <div class="mt-6 space-y-5">
            <div
              v-for="source in [{ label: 'Schedra pages', value: data.sources.hosted }, { label: 'Website embed', value: data.sources.embed }]"
              :key="source.label"
            >
              <div class="flex justify-between text-[13px]">
                <span class="font-medium text-highlighted">{{ source.label }}</span><span class="text-muted">{{ source.value }} · {{ sourcePercentage(source.value) }}%</span>
              </div>
              <div class="mt-2 h-2 overflow-hidden rounded-full bg-elevated">
                <div
                  class="h-full rounded-full bg-primary"
                  :style="{ width: `${sourcePercentage(source.value)}%` }"
                />
              </div>
            </div>
          </div>
          <div
            v-if="canUseAdvancedAnalytics"
            class="mt-7 border-t border-default pt-5"
          >
            <p class="text-[13px] font-medium text-muted">
              Gross revenue
            </p>
            <div
              v-if="data.revenue.length"
              class="mt-2 flex flex-wrap gap-x-5 gap-y-1"
            >
              <p
                v-for="amount in data.revenue"
                :key="amount.currency"
                class="text-xl font-semibold text-highlighted"
              >
                {{ formatMoney(amount.amountCents, amount.currency) }}
              </p>
            </div>
            <p
              v-else
              class="mt-2 text-xl font-semibold text-highlighted"
            >
              —
            </p>
            <p class="mt-1 text-[12px] text-dimmed">
              Paid bookings before Schedra, Bachs processing and withdrawal fees. Refunds are excluded.
            </p>
          </div>
          <div
            v-else
            class="mt-7 border-t border-default pt-5"
          >
            <div class="flex items-start gap-3 rounded-xl bg-muted p-4">
              <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <UIcon
                  name="i-lucide-sparkles"
                  class="size-4"
                />
              </span>
              <div>
                <p class="text-[13px] font-semibold text-highlighted">
                  Revenue reporting and CSV exports
                </p>
                <p class="mt-1 text-[12px] leading-relaxed text-muted">
                  Personal Pro adds paid-booking revenue totals and downloadable reports.
                </p>
                <NuxtLink
                  to="/billing"
                  class="mt-2 inline-block text-[12px] font-medium text-primary hover:underline"
                >
                  See Personal Pro
                </NuxtLink>
              </div>
            </div>
          </div>
        </section>

        <section class="overflow-hidden rounded-xl border border-default bg-default">
          <header class="border-b border-default px-5 py-4">
            <h2 class="text-[15px] font-semibold text-highlighted">
              Event type performance
            </h2>
            <p class="mt-1 text-[12px] text-muted">
              Your ten most-booked event types in this period.
            </p>
          </header>
          <div
            v-if="!data.eventTypes.length"
            class="px-5 py-12 text-center text-[13px] text-muted"
          >
            Performance appears after your first booking.
          </div>
          <div
            v-else
            class="overflow-x-auto"
          >
            <table class="w-full min-w-[32rem] text-left">
              <thead class="border-b border-default text-[12px] uppercase tracking-wide text-dimmed">
                <tr>
                  <th class="px-5 py-3 font-medium">
                    Event type
                  </th><th class="px-4 py-3 text-right font-medium">
                    Bookings
                  </th><th class="px-4 py-3 text-right font-medium">
                    Confirmed
                  </th><th class="px-5 py-3 text-right font-medium">
                    Cancelled
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default text-[13px]">
                <tr
                  v-for="item in data.eventTypes"
                  :key="item.id"
                >
                  <td class="max-w-56 truncate px-5 py-3.5 font-medium text-highlighted">
                    {{ item.title }}
                  </td>
                  <td class="px-4 py-3.5 text-right text-muted">
                    {{ item.total }}
                  </td>
                  <td class="px-4 py-3.5 text-right text-muted">
                    {{ item.confirmed }}
                  </td>
                  <td class="px-5 py-3.5 text-right text-muted">
                    {{ item.cancellationRate }}%
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
