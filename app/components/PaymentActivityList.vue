<script setup lang="ts">
import { formatMoney } from '#shared/payments'
import { operationsApi, paymentsApi, type PaymentActivityRecord, type PaymentActivityResponse } from '~/services/schedra-api'

const props = withDefaults(defineProps<{ teamSlug?: string, operations?: boolean }>(), { operations: false })
const direction = ref<'all' | 'in' | 'out'>('all')
const state = ref<'all' | 'pending' | 'succeeded' | 'failed' | 'expired'>('all')
const query = ref('')
const search = ref('')
const page = ref(1)
const apiQuery = computed(() => ({
  direction: direction.value,
  status: state.value,
  search: search.value,
  page: page.value,
  pageSize: 10
}))
const { data, status, error, refresh } = await useLazyFetch<PaymentActivityResponse>(
  () => props.operations ? operationsApi.paymentsEndpoint : paymentsApi.activityEndpoint(props.teamSlug),
  { query: apiQuery }
)

const initialLoading = computed(() => status.value === 'pending' && !data.value)
const refreshing = computed(() => status.value === 'pending' && Boolean(data.value))
const directionOptions = [
  { label: 'All activity', value: 'all' },
  { label: 'Into payout account', value: 'in' },
  { label: 'Out of payout account', value: 'out' }
]
const statusOptions = [
  { label: 'Every status', value: 'all' },
  { label: 'Succeeded', value: 'succeeded' },
  { label: 'Pending', value: 'pending' },
  { label: 'Failed', value: 'failed' },
  { label: 'Expired', value: 'expired' }
]

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(query, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    search.value = value.trim()
    page.value = 1
  }, 250)
})
watch([direction, state], () => {
  page.value = 1
})
onBeforeUnmount(() => clearTimeout(searchTimer))

const statusColor = (value: PaymentActivityRecord['status']) => ({
  succeeded: 'success', pending: 'warning', failed: 'error', expired: 'neutral'
} as const)[value]

function amount(item: PaymentActivityRecord) {
  if (item.amountCents == null) return 'Amount unavailable'
  const sign = item.direction === 'in' ? '+' : item.direction === 'out' ? '−' : ''
  return `${sign}${formatMoney(item.amountCents, item.currency)}`
}

function timestamp(value: string) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium', timeStyle: 'short'
  }).format(new Date(value))
}

function traceRows(item: PaymentActivityRecord) {
  return [
    ['Payment reference', item.paymentReference],
    ['Provider object', item.providerObjectId],
    ['Provider event', item.providerEventId],
    ['Guest', item.attendeeEmail]
  ].filter((row): row is [string, string] => Boolean(row[1]))
}
</script>

<template>
  <section class="overflow-hidden rounded-2xl border border-default bg-default">
    <header class="flex flex-col gap-5 border-b border-default p-5 sm:p-6 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div class="flex items-center gap-2">
          <span class="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UIcon
              name="i-lucide-receipt-text"
              class="size-4"
            />
          </span>
          <h2 class="text-base font-semibold text-highlighted">
            {{ operations ? 'Payment ledger' : 'Payments and payouts' }}
          </h2>
        </div>
        <p class="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          {{ operations
            ? 'Trace checkouts, customer payments, fees, settlements and refunds. Amounts shown are only values confirmed by Bachs.'
            : 'See successful customer payments and provider-reported settlement amounts for this payout account.' }}
        </p>
      </div>
      <div
        class="grid gap-2 lg:w-auto"
        :class="operations ? 'sm:grid-cols-[minmax(12rem,1fr)_10rem_10rem]' : 'sm:w-72'"
      >
        <UInput
          v-model="query"
          icon="i-lucide-search"
          placeholder="Guest, event or reference"
          aria-label="Search payment activity"
        />
        <USelectMenu
          v-if="operations"
          v-model="direction"
          :items="directionOptions"
          value-key="value"
          aria-label="Filter by direction"
        />
        <USelectMenu
          v-if="operations"
          v-model="state"
          :items="statusOptions"
          value-key="value"
          aria-label="Filter by status"
        />
      </div>
    </header>

    <div
      v-if="initialLoading"
      class="space-y-px bg-default"
      aria-label="Loading payment activity"
    >
      <div
        v-for="index in 4"
        :key="index"
        class="flex gap-4 p-5"
      >
        <USkeleton class="size-10 shrink-0 rounded-xl" />
        <div class="flex-1 space-y-2">
          <USkeleton class="h-4 w-48" /><USkeleton class="h-3 w-72 max-w-full" />
        </div>
        <USkeleton class="h-7 w-24" />
      </div>
    </div>
    <AsyncErrorState
      v-else-if="error && !data"
      title="Could not load payment activity"
      description="No records were changed. Check your connection and try again."
      :retrying="status === 'pending'"
      @retry="refresh"
    />
    <ListEmptyState
      v-else-if="!data?.items.length"
      icon="i-lucide-receipt-text"
      :title="query || (operations && (direction !== 'all' || state !== 'all')) ? 'No matching payment activity' : 'No payment activity yet'"
      :description="query || (operations && (direction !== 'all' || state !== 'all')) ? 'Try another search or remove a filter.' : operations ? 'Paid booking checkouts and money movements will appear here.' : 'Successful payments and provider-reported settlements will appear here.'"
    />
    <template v-else>
      <ul
        class="divide-y divide-default"
        :class="refreshing && 'opacity-60'"
      >
        <li
          v-for="item in data.items"
          :key="item.id"
        >
          <details
            class="group"
            :open="!operations"
          >
            <summary
              class="flex list-none flex-col gap-4 p-5 transition-colors sm:flex-row sm:items-center"
              :class="operations ? 'cursor-pointer hover:bg-elevated/60' : 'cursor-default'"
              @click="!operations && $event.preventDefault()"
            >
              <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <UIcon
                  :name="item.icon"
                  class="size-4"
                />
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="text-sm font-semibold text-highlighted">
                    {{ item.label }}
                  </p>
                  <UBadge
                    :color="statusColor(item.status)"
                    variant="subtle"
                    size="sm"
                  >
                    {{ item.status }}
                  </UBadge>
                </div>
                <p class="mt-1 truncate text-xs text-muted">
                  {{ item.eventTitle }} · {{ item.from }} → {{ item.to }}
                </p>
                <p class="mt-0.5 text-[11px] text-dimmed">
                  {{ timestamp(item.occurredAt) }}
                </p>
              </div>
              <div class="flex items-center justify-between gap-3 sm:justify-end">
                <p
                  class="text-sm font-semibold tabular-nums"
                  :class="item.direction === 'in' ? 'text-success' : item.direction === 'out' ? 'text-error' : 'text-toned'"
                >
                  {{ amount(item) }}
                </p>
                <UIcon
                  v-if="operations"
                  name="i-lucide-chevron-down"
                  class="size-4 text-dimmed transition-transform group-open:rotate-180"
                />
              </div>
            </summary>
            <div
              v-if="operations"
              class="surface-secondary border-t border-default px-5 py-4 sm:pl-[4.75rem]"
            >
              <dl class="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
                <div
                  v-for="[label, value] in traceRows(item)"
                  :key="label"
                  class="min-w-0"
                >
                  <dt class="text-[10px] font-medium uppercase tracking-wide text-dimmed">
                    {{ label }}
                  </dt>
                  <dd class="mt-1 break-all text-xs text-toned">
                    {{ value }}
                  </dd>
                </div>
              </dl>
              <div class="mt-4 flex flex-col gap-3 border-t border-default pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p class="text-xs text-muted">
                  {{ item.message || 'Recorded from the payment provider.' }}
                </p>
                <UButton
                  :to="item.bookingPath"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  trailing-icon="i-lucide-arrow-right"
                >
                  Open booking
                </UButton>
              </div>
            </div>
          </details>
        </li>
      </ul>
      <ListPagination
        :page="data.pagination.page"
        :total-pages="data.pagination.totalPages"
        :total="data.pagination.total"
        :disabled="refreshing"
        @change="page = $event"
      />
    </template>
  </section>
</template>
