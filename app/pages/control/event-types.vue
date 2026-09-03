<script setup lang="ts">
import { controlApi, type ControlEventTypeRecord, type ControlListResponse } from '~/services/schedra-api'
import { DEFAULT_LIST_PAGE_SIZE } from '~/constants/lists'
import { formatDate } from '~/utils/date-time'

definePageMeta({ layout: 'app', middleware: ['auth', 'platform-admin'] })
useSeoMeta({ title: 'Event types · Control', robots: 'noindex, nofollow' })

const { query, search, page } = useListQueryState()
const apiQuery = computed(() => ({ page: page.value, pageSize: DEFAULT_LIST_PAGE_SIZE, search: search.value }))
const { data, status, error, refresh } = await useLazyFetch<ControlListResponse<ControlEventTypeRecord>>(
  controlApi.eventTypesEndpoint,
  { query: apiQuery }
)
const { initialLoading, refreshing, blockingFailure } = useListLoadingState(status, data, error)
const eventTypes = computed(() => data.value?.items ?? [])
</script>

<template>
  <div>
    <ControlNavigation />
    <PageHeader
      title="Event types"
      description="Review personal and team booking links across Schedra."
    />

    <section class="mt-7 overflow-hidden rounded-xl border border-default bg-default">
      <div class="surface-secondary flex flex-col gap-3 border-b border-default px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <p class="text-[13px] text-muted">
          {{ data?.pagination.total ?? 0 }} total event types
        </p>
        <UInput
          v-model="query"
          icon="i-lucide-search"
          placeholder="Search event type or owner"
          aria-label="Search event types"
          class="w-full sm:w-80"
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
        :rows="5"
        label="Loading event types"
      />
      <AsyncErrorState
        v-else-if="blockingFailure"
        title="Could not load event types"
        description="The event type list could not be loaded."
        :retrying="status === 'pending'"
        @retry="refresh"
      />
      <template v-else>
        <AsyncErrorState
          v-if="error"
          compact
          class="border-b border-default bg-error/5"
          title="Could not refresh event types"
          description="The previous results are still shown."
          :retrying="refreshing"
          @retry="refresh"
        />
        <div
          v-if="eventTypes.length"
          :class="refreshing && 'opacity-60'"
        >
          <ul class="divide-y divide-default">
            <li
              v-for="eventType in eventTypes"
              :key="eventType.id"
              class="flex flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:px-5"
            >
              <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-elevated text-muted">
                <UIcon
                  :name="eventType.scope === 'team' ? 'i-lucide-users' : 'i-lucide-user'"
                  class="size-4.5"
                />
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="truncate text-[14px] font-semibold text-highlighted">
                    {{ eventType.title }}
                  </p>
                  <span class="rounded-full bg-elevated px-2 py-0.5 text-[11px] font-medium capitalize text-muted">{{ eventType.scope }}</span>
                  <span
                    v-if="eventType.hidden"
                    class="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning"
                  >Hidden</span>
                  <span
                    v-if="eventType.paymentEnabled"
                    class="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success"
                  >Paid</span>
                </div>
                <p class="mt-1 truncate text-[12px] text-muted">
                  {{ eventType.organizationName || eventType.ownerName || 'Unknown owner' }} · /{{ eventType.slug }}
                </p>
                <p class="mt-1 text-[12px] text-dimmed">
                  Created {{ formatDate(eventType.createdAt) }}
                </p>
              </div>
              <dl class="grid grid-cols-3 gap-5 sm:w-72">
                <div>
                  <dt class="text-[11px] uppercase tracking-wide text-dimmed">
                    Duration
                  </dt><dd class="tnum mt-1 text-[13px] font-medium text-toned">
                    {{ eventType.durationMinutes }} min
                  </dd>
                </div>
                <div>
                  <dt class="text-[11px] uppercase tracking-wide text-dimmed">
                    Capacity
                  </dt><dd class="tnum mt-1 text-[13px] font-medium text-toned">
                    {{ eventType.capacity }}
                  </dd>
                </div>
                <div>
                  <dt class="text-[11px] uppercase tracking-wide text-dimmed">
                    Bookings
                  </dt><dd class="tnum mt-1 text-[13px] font-medium text-toned">
                    {{ eventType.bookingCount }}
                  </dd>
                </div>
              </dl>
              <UButton
                v-if="eventType.userId"
                :to="`/control/users/${eventType.userId}`"
                icon="i-lucide-chevron-right"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="View owner"
              />
            </li>
          </ul>
          <ListPagination
            :page="data!.pagination.page"
            :total-pages="data!.pagination.totalPages"
            :total="data!.pagination.total"
            :page-size="data!.pagination.pageSize"
            :disabled="refreshing"
            @change="page = $event"
          />
        </div>
        <ListEmptyState
          v-else
          icon="i-lucide-link-2"
          :title="query ? 'No matching event types' : 'No event types yet'"
          :description="query ? 'Try another title, slug, owner or team.' : 'Created event types will appear here.'"
        />
      </template>
    </section>
  </div>
</template>
