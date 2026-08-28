<script setup lang="ts">
import {
  apiErrorMessage,
  operationsApi,
  type OperationsDiagnostics,
  type OperationsJobsResponse,
  type OperationsOverview,
  type OperationKind,
  type OperationStatus
} from '~/services/schedra-api'

definePageMeta({ layout: 'app', middleware: ['auth', 'platform-admin'] })
useSeoMeta({ title: 'Operations — Schedra', robots: 'noindex, nofollow' })

const feedback = useFeedback()
const kind = ref<OperationKind>('calendar')
const filter = ref<OperationStatus>('all')
const page = ref(1)
const retryingId = ref<string | null>(null)
const requestFetch = useRequestFetch()

const { data: overview, status: overviewStatus, error: overviewError, refresh: refreshOverview } = await useAsyncData(
  'operations-overview', (_nuxtApp, { signal }) => requestFetch<OperationsOverview>(
    operationsApi.overviewEndpoint, { signal }
  )
)
const { data: diagnostics, status: diagnosticsStatus, error: diagnosticsError, refresh: refreshDiagnostics } = await useAsyncData(
  'operations-diagnostics', (_nuxtApp, { signal }) => requestFetch<OperationsDiagnostics>(
    operationsApi.diagnosticsEndpoint, { signal }
  )
)
const { data: jobs, status: jobsStatus, error: jobsError, refresh: refreshJobs } = await useAsyncData(
  'operations-jobs', (_nuxtApp, { signal }) => requestFetch<OperationsJobsResponse>(operationsApi.jobsEndpoint, {
    query: { kind: kind.value, status: filter.value, page: page.value, pageSize: 10 },
    signal
  }),
  { watch: [kind, filter, page] }
)

watch([kind, filter], () => {
  page.value = 1
})

const kinds: Array<{ value: OperationKind, label: string, icon: string }> = [
  { value: 'calendar', label: 'Calendar sync', icon: 'i-lucide-calendar-sync' },
  { value: 'billing', label: 'Seat billing', icon: 'i-lucide-credit-card' },
  { value: 'email', label: 'Email delivery', icon: 'i-lucide-mail' },
  { value: 'webhook', label: 'Webhooks', icon: 'i-lucide-webhook' }
]

const filters: OperationStatus[] = ['all', 'pending', 'processing', 'completed', 'failed', 'ignored']
const visibleFilters = computed(() => filters.filter(value => (
  kind.value === 'webhook' ? value !== 'pending' : value !== 'ignored'
)))

const queueCards = computed(() => overview.value
  ? [
      { label: 'Calendar sync', icon: 'i-lucide-calendar-sync', ...overview.value.queues.calendar },
      { label: 'Seat billing', icon: 'i-lucide-credit-card', ...overview.value.queues.billing },
      { label: 'Email delivery', icon: 'i-lucide-mail', ...overview.value.queues.email },
      { label: 'Webhooks', icon: 'i-lucide-webhook', pending: 0, ...overview.value.queues.webhook }
    ]
  : [])
const queueTotals = computed(() => queueCards.value.reduce((total, queue) => ({
  pending: total.pending + queue.pending,
  processing: total.processing + queue.processing,
  failed: total.failed + queue.failed,
  stale: total.stale + queue.stale
}), { pending: 0, processing: 0, failed: 0, stale: 0 }))
const systemState = computed(() => {
  if (overviewStatus.value === 'pending' || diagnosticsStatus.value === 'pending') {
    return { label: 'Checking system health', description: 'Refreshing queues and worker diagnostics.', icon: 'i-lucide-loader-circle', tone: 'info' as const }
  }
  if (diagnosticsError.value || !diagnostics.value?.worker.ok || overview.value?.alerts.some(alert => alert.severity === 'critical')) {
    return { label: 'Action required', description: 'A critical dependency or background operation needs attention.', icon: 'i-lucide-circle-alert', tone: 'error' as const }
  }
  if (queueTotals.value.failed || queueTotals.value.stale || overview.value?.alerts.length) {
    return { label: 'Degraded', description: 'Core services are online, but some work needs review.', icon: 'i-lucide-triangle-alert', tone: 'warning' as const }
  }
  return { label: 'All systems operational', description: 'Queues, workers and configured providers are responding normally.', icon: 'i-lucide-circle-check-big', tone: 'success' as const }
})

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

// Operators scan for "how long ago", not for a calendar date. The absolute time
// stays available on hover.
function ago(value: string) {
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

// Headline counts. Failures and delays lead because they are the only two an
// operator can act on; queued and running are context.
const headlineStats = computed(() => [
  { label: 'Failed', value: queueTotals.value.failed, tone: queueTotals.value.failed ? 'error' : 'idle' },
  { label: 'Delayed', value: queueTotals.value.stale, tone: queueTotals.value.stale ? 'warning' : 'idle' },
  { label: 'Running', value: queueTotals.value.processing, tone: 'idle' },
  { label: 'Queued', value: queueTotals.value.pending, tone: 'idle' }
] as const)

/**
 * An unconfigured optional integration is a fact, not a fault — colouring it
 * amber makes a healthy install look broken. Only things that are actually
 * wrong get a status colour.
 */
const OPTIONAL_PROVIDERS = new Set(['google', 'microsoft', 'zoom'])

const providerRows = computed(() => {
  const config = diagnostics.value?.configuration
  if (!config) return []

  return (Object.entries(config) as Array<[string, boolean | number]>)
    .filter(([key]) => key !== 'alertRecipients')
    .map(([key, configured]) => ({
      key,
      label: key.replace(/([A-Z])/g, ' $1'),
      configured: Boolean(configured),
      optional: OPTIONAL_PROVIDERS.has(key)
    }))
})

async function refreshAll() {
  await Promise.all([refreshOverview(), refreshDiagnostics(), refreshJobs()])
}

async function retry(jobKind: OperationKind, id: string) {
  retryingId.value = id
  try {
    await operationsApi.retry(jobKind, id)
    feedback.success({ title: 'Operation queued again' })
    await refreshAll()
  } catch (failure) {
    feedback.error({ title: apiErrorMessage(failure, 'The operation could not be retried.') })
  } finally {
    retryingId.value = null
  }
}
</script>

<template>
  <main class="mx-auto w-full max-w-7xl space-y-8 px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
    <PageHeader
      title="Operations"
      description="Private delivery health, failures and safe recovery controls."
    >
      <template #actions>
        <UButton
          label="Refresh"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          :loading="overviewStatus === 'pending' || diagnosticsStatus === 'pending' || jobsStatus === 'pending'"
          @click="refreshAll"
        />
      </template>
    </PageHeader>

    <AsyncErrorState
      v-if="overviewError"
      title="Could not load operations"
      description="The private health data could not be loaded."
      :retrying="overviewStatus === 'pending'"
      @retry="refreshAll"
    />

    <template v-else>
      <section class="overflow-hidden rounded-2xl border border-default bg-default">
        <div
          class="flex items-center gap-3 border-b px-5 py-4"
          :class="{
            'border-success/25 bg-success/5': systemState.tone === 'success',
            'border-warning/25 bg-warning/5': systemState.tone === 'warning',
            'border-error/25 bg-error/5': systemState.tone === 'error',
            'border-info/25 bg-info/5': systemState.tone === 'info'
          }"
        >
          <UIcon
            :name="systemState.icon"
            class="size-4.5 shrink-0"
            :class="[
              {
                'text-success': systemState.tone === 'success',
                'text-warning': systemState.tone === 'warning',
                'text-error': systemState.tone === 'error',
                'text-info': systemState.tone === 'info'
              },
              systemState.tone === 'info' && 'animate-spin'
            ]"
          />
          <div class="min-w-0 flex-1">
            <h2 class="text-[14px] font-semibold text-highlighted">
              {{ systemState.label }}
            </h2>
            <p class="mt-0.5 text-[12px] text-muted">
              {{ systemState.description }}
            </p>
          </div>
        </div>

        <dl class="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          <div
            v-for="stat in headlineStats"
            :key="stat.label"
            class="bg-default px-5 py-4"
          >
            <dt class="text-[11px] font-medium uppercase tracking-wide text-dimmed">
              {{ stat.label }}
            </dt>
            <dd
              class="mt-1.5 text-[28px] font-semibold leading-none"
              :class="{
                'text-error': stat.tone === 'error',
                'text-warning': stat.tone === 'warning',
                'text-highlighted': stat.tone === 'idle' && stat.value > 0,
                'text-dimmed': stat.tone === 'idle' && stat.value === 0
              }"
            >
              {{ stat.value }}
            </dd>
          </div>
        </dl>
      </section>

      <section
        v-if="overview?.alerts.length"
        class="overflow-hidden rounded-2xl border border-error/30 bg-error/5"
      >
        <div class="border-b border-error/20 px-5 py-4">
          <h2 class="text-[15px] font-semibold text-highlighted">
            Active alerts
          </h2>
          <p class="mt-1 text-[13px] text-muted">
            Grouped conditions that currently need attention.
          </p>
        </div>
        <div class="divide-y divide-error/15">
          <div
            v-for="alert in overview.alerts"
            :key="alert.id"
            class="flex items-start gap-3 px-5 py-4"
          >
            <UIcon
              :name="alert.severity === 'critical' ? 'i-lucide-circle-alert' : 'i-lucide-triangle-alert'"
              class="mt-0.5 size-4.5 shrink-0 text-error"
            />
            <div class="min-w-0 flex-1">
              <p class="text-[14px] font-medium text-highlighted">
                {{ alert.summary }}
              </p>
              <p class="mt-1 text-[12px] text-muted">
                Last detected {{ formatDate(alert.lastSeenAt) }}
              </p>
            </div>
            <UBadge
              :label="alert.severity"
              color="error"
              variant="subtle"
              class="capitalize"
            />
          </div>
        </div>
      </section>

      <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article
          v-for="queue in queueCards"
          :key="queue.label"
          class="rounded-2xl border bg-default p-4"
          :class="queue.failed ? 'border-error/30' : queue.stale ? 'border-warning/30' : 'border-default'"
        >
          <div class="flex items-center gap-2.5">
            <UIcon
              :name="queue.icon"
              class="size-4 shrink-0 text-dimmed"
            />
            <h2 class="min-w-0 flex-1 truncate text-[13px] font-medium text-highlighted">
              {{ queue.label }}
            </h2>
          </div>

          <!-- The failing count is the reason to look at this card, so it is the
               number the card shows; a healthy queue says so in words. -->
          <p
            v-if="queue.failed"
            class="mt-3 flex items-baseline gap-1.5"
          >
            <span class="text-[26px] font-semibold leading-none text-error">{{ queue.failed }}</span>
            <span class="text-[12px] text-muted">failed</span>
          </p>
          <p
            v-else-if="queue.stale"
            class="mt-3 flex items-baseline gap-1.5"
          >
            <span class="text-[26px] font-semibold leading-none text-warning">{{ queue.stale }}</span>
            <span class="text-[12px] text-muted">delayed</span>
          </p>
          <p
            v-else
            class="mt-3 flex items-center gap-1.5 text-[13px] text-muted"
          >
            <UIcon
              name="i-lucide-check"
              class="size-3.5 text-success"
            />
            Healthy
          </p>

          <p class="mt-2.5 text-[11px] text-dimmed">
            {{ queue.processing }} running · {{ queue.pending }} queued<template v-if="queue.failed && queue.stale">
              · {{ queue.stale }} delayed
            </template>
          </p>
        </article>
      </section>

      <section class="overflow-hidden rounded-2xl border border-default bg-default">
        <header class="flex flex-wrap items-center justify-between gap-3 border-b border-default px-5 py-4">
          <div>
            <h2 class="text-[14px] font-semibold text-highlighted">
              Readiness
            </h2>
            <p class="mt-0.5 text-[12px] text-muted">
              Reported without exposing any credential.
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2 text-[12px]">
            <span class="rounded-lg border border-default px-2.5 py-1 text-muted">
              Database <span class="font-medium text-highlighted">{{ diagnostics?.database.latencyMs ?? '—' }} ms</span>
            </span>
            <UBadge
              :label="diagnostics?.worker.ok ? `Worker · ${diagnostics.worker.active} online` : 'Worker offline'"
              :color="diagnostics?.worker.ok ? 'success' : 'error'"
              :icon="diagnostics?.worker.ok ? 'i-lucide-check' : 'i-lucide-circle-alert'"
              variant="subtle"
            />
            <UBadge
              :label="`${diagnostics?.configuration.alertRecipients ?? 0} alert recipients`"
              color="neutral"
              variant="subtle"
            />
          </div>
        </header>

        <ul class="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
          <li
            v-for="provider in providerRows"
            :key="provider.key"
            class="flex items-center justify-between gap-3 bg-default px-5 py-3"
          >
            <span class="min-w-0 truncate text-[13px] capitalize text-toned">{{ provider.label }}</span>
            <span
              v-if="provider.configured"
              class="flex shrink-0 items-center gap-1.5 text-[12px] text-muted"
            >
              <UIcon
                name="i-lucide-check"
                class="size-3.5 text-success"
              />
              Connected
            </span>
            <span
              v-else
              class="shrink-0 text-[12px]"
              :class="provider.optional ? 'text-dimmed' : 'text-warning'"
            >
              {{ provider.optional ? 'Not set up' : 'Missing' }}
            </span>
          </li>
        </ul>
      </section>

      <section class="overflow-hidden rounded-2xl border border-default bg-default">
        <div class="border-b border-default p-4 sm:p-5">
          <div class="flex flex-wrap gap-2">
            <UButton
              v-for="item in kinds"
              :key="item.value"
              :label="item.label"
              :icon="item.icon"
              color="neutral"
              :variant="kind === item.value ? 'soft' : 'ghost'"
              :aria-pressed="kind === item.value"
              @click="kind = item.value"
            />
          </div>
          <div class="mt-4 flex flex-wrap gap-2">
            <button
              v-for="value in visibleFilters"
              :key="value"
              type="button"
              class="rounded-lg px-3 py-1.5 text-[12px] font-medium capitalize transition-colors"
              :class="filter === value ? 'bg-primary/15 text-primary' : 'text-muted hover:bg-muted hover:text-highlighted'"
              :aria-pressed="filter === value"
              @click="filter = value"
            >
              {{ value }}
            </button>
          </div>
        </div>

        <AsyncErrorState
          v-if="jobsError"
          class="m-5"
          title="Could not load operations"
          description="Try loading this queue again."
          :retrying="jobsStatus === 'pending'"
          @retry="refreshJobs"
        />
        <div
          v-else-if="jobsStatus === 'pending' && !jobs"
          class="space-y-3 p-5"
        >
          <USkeleton
            v-for="index in 5"
            :key="index"
            class="h-16 w-full rounded-xl"
          />
        </div>
        <ListEmptyState
          v-else-if="!jobs?.items.length"
          icon="i-lucide-circle-check-big"
          title="No matching operations"
          description="This queue has no records with the selected status."
          class="border-0"
        />
        <div
          v-else
          class="divide-y divide-default"
        >
          <article
            v-for="job in jobs.items"
            :key="job.id"
            class="px-5 py-4"
          >
            <div class="flex items-start gap-3">
              <!-- A dot, not a badge: status is repeated in words beneath, so
                   colour never carries the meaning by itself. -->
              <span
                class="mt-1.5 size-1.5 shrink-0 rounded-full"
                :class="job.status === 'failed' ? 'bg-error'
                  : job.status === 'completed' ? 'bg-success'
                    : job.status === 'processing' ? 'bg-info' : 'bg-dimmed'"
              />
              <div class="min-w-0 flex-1">
                <p class="truncate text-[14px] font-medium text-highlighted">
                  {{ job.label }}
                </p>
                <p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                  <span
                    class="capitalize"
                    :class="job.status === 'failed' && 'text-error'"
                  >{{ job.status }}</span>
                  <span class="text-dimmed">·</span>
                  <span :title="formatDate(job.updatedAt)">{{ ago(job.updatedAt) }}</span>
                  <span class="text-dimmed">·</span>
                  <span>{{ job.attempts }} attempt{{ job.attempts === 1 ? '' : 's' }}</span>
                  <template v-if="job.provider">
                    <span class="text-dimmed">·</span>
                    <span class="capitalize">{{ job.provider }}</span>
                  </template>
                </p>
              </div>
              <UButton
                v-if="job.retryable"
                label="Retry"
                icon="i-lucide-rotate-ccw"
                color="neutral"
                variant="outline"
                size="sm"
                class="shrink-0"
                :loading="retryingId === job.id"
                @click="retry(job.kind, job.id)"
              />
            </div>

            <p
              v-if="job.lastError"
              class="mt-2.5 ml-4.5 overflow-x-auto rounded-lg border border-error/20 bg-error/5 px-3 py-2 font-mono text-[11px] leading-relaxed text-error"
            >
              {{ job.lastError }}
            </p>
          </article>
        </div>
        <div
          v-if="jobs && jobs.pagination.totalPages > 1"
          class="border-t border-default p-4"
        >
          <ListPagination
            :page="page"
            :total-pages="jobs.pagination.totalPages"
            :total="jobs.pagination.total"
            :disabled="jobsStatus === 'pending'"
            @change="page = $event"
          />
        </div>

        <p class="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-default px-5 py-3 text-[11px] text-dimmed">
          <UIcon
            name="i-lucide-info"
            class="size-3.5"
          />
          Delayed and failed work surfaces here automatically · alerts are grouped to once an hour ·
          only failed, idempotent operations can be retried.
        </p>
      </section>
    </template>
  </main>
</template>
