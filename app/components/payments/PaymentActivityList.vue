<script setup lang="ts">
import { formatMoney } from '#shared/payments'
import { apiErrorMessage, operationsApi, paymentsApi, type PaymentActivityRecord, type PaymentActivityResponse } from '~/services/schedra-api'
import { DEFAULT_LIST_PAGE_SIZE } from '~/constants/lists'
import { formatCalendarDate, formatDateTime } from '~/utils/date-time'

const props = withDefaults(defineProps<{ teamSlug?: string, operations?: boolean }>(), { operations: false })
const feedback = useFeedback()
const retryingRefundId = ref<string | null>(null)
const direction = ref<'all' | 'in' | 'out'>('all')
const state = ref<'all' | 'pending' | 'succeeded' | 'failed' | 'expired'>('all')
const from = ref('')
const to = ref('')
const { query, search, page, resetPage, clearSearch } = useListQueryState()
const apiQuery = computed(() => ({
  direction: direction.value,
  status: state.value,
  from: from.value || undefined,
  to: to.value || undefined,
  search: search.value,
  page: page.value,
  pageSize: DEFAULT_LIST_PAGE_SIZE
}))
const { data, status, error, refresh } = await useLazyFetch<PaymentActivityResponse>(
  () => props.operations ? operationsApi.paymentsEndpoint : paymentsApi.activityEndpoint(props.teamSlug),
  { query: apiQuery }
)

const { initialLoading, refreshing } = useListLoadingState(status, data)
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

watch([direction, state, from, to], () => {
  resetPage()
})

const statusColor = (value: PaymentActivityRecord['status']) => ({
  succeeded: 'success', pending: 'warning', failed: 'error', expired: 'neutral'
} as const)[value]

const hasFilters = computed(() => Boolean(
  query.value || direction.value !== 'all' || state.value !== 'all' || from.value || to.value
))

function shortDate(value: string) {
  return formatCalendarDate(value, { dateStyle: 'medium' }, 'en')
}

function clearDates() {
  from.value = ''
  to.value = ''
}

const dateRangeLabel = computed(() => {
  if (from.value && to.value) return `${shortDate(from.value)} – ${shortDate(to.value)}`
  if (from.value) return `On or after ${shortDate(from.value)}`
  if (to.value) return `On or before ${shortDate(to.value)}`
  return ''
})

/**
 * Search stays in the header because it is used constantly; everything else
 * folds into one popover so the row cannot outgrow the section. Whatever is
 * applied comes back as a removable chip, so a hidden filter never silently
 * shapes the list.
 */
const appliedFilters = computed(() => {
  const chips: Array<{ key: string, label: string, clear: () => void }> = []
  if (search.value) {
    chips.push({ key: 'search', label: `Matching “${search.value}”`, clear: clearSearch })
  }
  if (direction.value !== 'all') {
    chips.push({
      key: 'direction',
      label: directionOptions.find(option => option.value === direction.value)?.label ?? '',
      clear: () => { direction.value = 'all' }
    })
  }
  if (state.value !== 'all') {
    chips.push({
      key: 'status',
      label: `Status: ${statusOptions.find(option => option.value === state.value)?.label ?? ''}`,
      clear: () => { state.value = 'all' }
    })
  }
  if (dateRangeLabel.value) {
    chips.push({ key: 'dates', label: `Happened ${dateRangeLabel.value.toLowerCase()}`, clear: clearDates })
  }
  return chips
})

const popoverFilterCount = computed(() => appliedFilters.value.filter(chip => chip.key !== 'search').length)

function clearFilters() {
  query.value = ''
  search.value = ''
  direction.value = 'all'
  state.value = 'all'
  from.value = ''
  to.value = ''
  page.value = 1
}

function amount(item: PaymentActivityRecord) {
  if (item.amountCents == null) return 'Amount unavailable'
  const sign = item.direction === 'in' ? '+' : item.direction === 'out' ? '−' : ''
  return `${sign}${formatMoney(item.amountCents, item.currency)}`
}

function timestamp(value: string) {
  return formatDateTime(value, 'en')
}

function traceRows(item: PaymentActivityRecord) {
  return [
    ['Payment reference', item.paymentReference],
    ['Provider object', item.providerObjectId],
    ['Provider event', item.providerEventId],
    ['Guest', item.attendeeEmail]
  ].filter((row): row is [string, string] => Boolean(row[1]))
}

async function retryRefund(item: PaymentActivityRecord) {
  retryingRefundId.value = item.id
  try {
    const result = await operationsApi.retryRefund(item.paymentReference)
    feedback.success({
      title: result.providerState === 'paid' ? 'Refund confirmed' : 'Refund submitted again',
      description: result.providerState === 'unknown'
        ? 'Bachs may have accepted it. Schedra will keep reconciling the refund safely.'
        : 'The payment ledger will update when Bachs confirms the final state.'
    })
    await refresh()
  } catch (failure) {
    feedback.error({ title: apiErrorMessage(failure, 'The refund could not be retried.') })
  } finally {
    retryingRefundId.value = null
  }
}
</script>

<template>
  <section class="overflow-hidden rounded-2xl border border-default bg-default">
    <header class="flex flex-col gap-5 border-b border-default p-5 sm:p-6 surface-secondary">
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
            : 'Track customer payments, refunds and provider-reported settlements for this payout account.' }}
        </p>
      </div>
      <div class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <UInput
            v-model="query"
            icon="i-lucide-search"
            placeholder="Account, guest, event or reference"
            aria-label="Search payment activity"
            class="min-w-52 flex-1 sm:max-w-sm"
          />

          <UPopover :content="{ align: 'start' }">
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-list-filter"
              trailing-icon="i-lucide-chevron-down"
            >
              Filters
              <UBadge
                v-if="popoverFilterCount"
                :label="String(popoverFilterCount)"
                color="primary"
                variant="subtle"
                size="sm"
                class="tnum"
              />
            </UButton>

            <template #content>
              <div class="w-[19rem] max-w-[calc(100vw-2rem)] space-y-4 p-4">
                <UFormField
                  v-if="operations"
                  label="Activity"
                  size="sm"
                >
                  <USelectMenu
                    v-model="direction"
                    :items="directionOptions"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>

                <UFormField
                  label="Status"
                  size="sm"
                >
                  <USelectMenu
                    v-model="state"
                    :items="statusOptions"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>

                <fieldset>
                  <legend class="text-[14px] font-medium text-highlighted">
                    When it happened
                  </legend>
                  <p class="mt-0.5 text-[13px] leading-relaxed text-muted">
                    Start and end of the range. Both match the date the money moved, not the date the booking is for.
                  </p>
                  <div class="mt-2.5 grid grid-cols-2 gap-2">
                    <UFormField
                      label="From"
                      size="xs"
                    >
                      <UInput
                        v-model="from"
                        type="date"
                        :max="to || undefined"
                        class="w-full"
                      />
                    </UFormField>
                    <UFormField
                      label="To"
                      size="xs"
                    >
                      <UInput
                        v-model="to"
                        type="date"
                        :min="from || undefined"
                        class="w-full"
                      />
                    </UFormField>
                  </div>
                </fieldset>
              </div>
            </template>
          </UPopover>

          <UButton
            v-if="hasFilters"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            @click="clearFilters"
          >
            Clear all
          </UButton>
        </div>

        <ul
          v-if="appliedFilters.length"
          class="flex flex-wrap items-center gap-1.5"
        >
          <li
            v-for="chip in appliedFilters"
            :key="chip.key"
          >
            <button
              type="button"
              class="flex items-center gap-1.5 rounded-full border border-default bg-default py-1 pl-2.5 pr-2 text-[13px] text-toned transition-colors hover:border-error/40 hover:text-error"
              :aria-label="`Remove filter: ${chip.label}`"
              @click="chip.clear()"
            >
              {{ chip.label }}
              <UIcon
                name="i-lucide-x"
                class="size-3"
              />
            </button>
          </li>
        </ul>
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
      :title="hasFilters ? 'No matching payment activity' : 'No payment activity yet'"
      :description="hasFilters ? 'Try another search or remove a filter.' : operations ? 'Paid booking checkouts and money movements will appear here.' : 'Customer payments, refunds and provider-reported settlements will appear here.'"
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
                <p class="mt-0.5 text-[12px] text-dimmed">
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
                  <dt class="text-[12px] font-medium uppercase tracking-wide text-dimmed">
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
                <div class="flex flex-wrap items-center gap-2">
                  <UButton
                    v-if="item.kind === 'refund' && item.status === 'failed'"
                    label="Retry refund"
                    icon="i-lucide-rotate-ccw"
                    color="error"
                    variant="outline"
                    size="sm"
                    :loading="retryingRefundId === item.id"
                    @click="retryRefund(item)"
                  />
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
            </div>
          </details>
        </li>
      </ul>
      <ListPagination
        :page="data.pagination.page"
        :total-pages="data.pagination.totalPages"
        :total="data.pagination.total"
        :page-size="data.pagination.pageSize"
        :disabled="refreshing"
        @change="page = $event"
      />
    </template>
  </section>
</template>
