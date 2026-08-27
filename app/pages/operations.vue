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
const { data: diagnostics, refresh: refreshDiagnostics } = await useAsyncData(
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

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
          :loading="overviewStatus === 'pending' || jobsStatus === 'pending'"
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

      <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article
          v-for="queue in queueCards"
          :key="queue.label"
          class="rounded-2xl border border-default bg-default p-5"
        >
          <div class="flex items-center justify-between">
            <span class="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <UIcon
                :name="queue.icon"
                class="size-4.5"
              />
            </span>
            <UBadge
              :label="queue.failed ? `${queue.failed} failed` : 'Healthy'"
              :color="queue.failed ? 'error' : 'success'"
              variant="subtle"
            />
          </div>
          <h2 class="mt-5 text-[15px] font-semibold text-highlighted">
            {{ queue.label }}
          </h2>
          <p class="mt-2 text-[13px] text-muted">
            {{ queue.pending }} pending · {{ queue.processing }} processing · {{ queue.stale }} delayed
          </p>
        </article>
      </section>

      <section class="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <article class="rounded-2xl border border-default bg-default p-5">
          <h2 class="text-[15px] font-semibold text-highlighted">
            Readiness diagnostics
          </h2>
          <p class="mt-1 text-[13px] text-muted">
            Configuration is reported without exposing credentials.
          </p>
          <div class="mt-5 space-y-3 text-[13px]">
            <div class="flex items-center justify-between">
              <span class="text-muted">Database</span>
              <span class="font-medium text-highlighted">{{ diagnostics?.database.latencyMs ?? '—' }} ms</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-muted">Background worker</span>
              <UBadge
                :label="diagnostics?.worker.ok ? `${diagnostics.worker.active} online` : 'Offline'"
                :color="diagnostics?.worker.ok ? 'success' : 'error'"
                variant="subtle"
              />
            </div>
            <div
              v-for="(configured, provider) in diagnostics?.configuration"
              :key="provider"
              class="flex items-center justify-between"
            >
              <span class="capitalize text-muted">{{ String(provider).replace(/([A-Z])/g, ' $1') }}</span>
              <UBadge
                v-if="provider === 'alertRecipients'"
                :label="String(configured)"
                color="neutral"
                variant="subtle"
              />
              <UBadge
                v-else
                :label="configured ? 'Configured' : 'Not configured'"
                :color="configured ? 'success' : 'warning'"
                variant="subtle"
              />
            </div>
          </div>
        </article>

        <article class="overflow-hidden rounded-2xl border border-default bg-default">
          <div class="border-b border-default px-5 py-4">
            <h2 class="text-[15px] font-semibold text-highlighted">
              How recovery works
            </h2>
          </div>
          <div class="grid gap-px bg-border sm:grid-cols-3">
            <div class="bg-default p-5">
              <UIcon
                name="i-lucide-scan-search"
                class="size-4.5 text-primary"
              />
              <p class="mt-3 text-[13px] font-medium text-highlighted">
                Detect
              </p>
              <p class="mt-1 text-[12px] leading-5 text-muted">
                Delayed and terminal jobs become visible automatically.
              </p>
            </div>
            <div class="bg-default p-5">
              <UIcon
                name="i-lucide-bell-ring"
                class="size-4.5 text-primary"
              />
              <p class="mt-3 text-[13px] font-medium text-highlighted">
                Notify
              </p>
              <p class="mt-1 text-[12px] leading-5 text-muted">
                Alerts are grouped and rate-limited to once per hour.
              </p>
            </div>
            <div class="bg-default p-5">
              <UIcon
                name="i-lucide-rotate-ccw"
                class="size-4.5 text-primary"
              />
              <p class="mt-3 text-[13px] font-medium text-highlighted">
                Recover
              </p>
              <p class="mt-1 text-[12px] leading-5 text-muted">
                Only failed, idempotent operations expose a retry action.
              </p>
            </div>
          </div>
        </article>
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
            class="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center"
          >
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <p class="truncate text-[14px] font-medium text-highlighted">
                  {{ job.label }}
                </p>
                <UBadge
                  :label="job.status"
                  :color="job.status === 'failed' ? 'error' : job.status === 'completed' ? 'success' : 'neutral'"
                  variant="subtle"
                  class="capitalize"
                />
                <UBadge
                  v-if="job.provider"
                  :label="job.provider"
                  color="neutral"
                  variant="outline"
                  class="capitalize"
                />
              </div>
              <p class="mt-1 text-[12px] text-muted">
                {{ formatDate(job.updatedAt) }} · {{ job.attempts }} attempt{{ job.attempts === 1 ? '' : 's' }}
              </p>
              <p
                v-if="job.lastError"
                class="mt-2 line-clamp-2 text-[12px] leading-5 text-error"
              >
                {{ job.lastError }}
              </p>
            </div>
            <UButton
              v-if="job.retryable"
              label="Retry"
              icon="i-lucide-rotate-ccw"
              color="neutral"
              variant="outline"
              :loading="retryingId === job.id"
              @click="retry(job.kind, job.id)"
            />
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
      </section>
    </template>
  </main>
</template>
