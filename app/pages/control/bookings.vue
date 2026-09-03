<script setup lang="ts">
import { controlApi, type ControlBookingRecord, type ControlListResponse } from '~/services/schedra-api'
import { DEFAULT_LIST_PAGE_SIZE } from '~/constants/lists'
import { formatDateTime } from '~/utils/date-time'

definePageMeta({ layout: 'app', middleware: ['auth', 'platform-admin'] })
useSeoMeta({ title: 'Bookings · Control', robots: 'noindex, nofollow' })

const { query, search, page } = useListQueryState()
const apiQuery = computed(() => ({ page: page.value, pageSize: DEFAULT_LIST_PAGE_SIZE, search: search.value }))
const { data, status, error, refresh } = await useLazyFetch<ControlListResponse<ControlBookingRecord>>(
  controlApi.bookingsEndpoint,
  { query: apiQuery }
)
const { initialLoading, refreshing, blockingFailure } = useListLoadingState(status, data, error)
const bookings = computed(() => data.value?.items ?? [])
</script>

<template>
  <div>
    <ControlNavigation />
    <PageHeader
      title="Bookings"
      description="Inspect booking activity without exposing guest answers or private contact details."
    />

    <section class="mt-7 overflow-hidden rounded-xl border border-default bg-default">
      <div class="surface-secondary flex flex-col gap-3 border-b border-default px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <p class="text-[13px] text-muted">
          {{ data?.pagination.total ?? 0 }} total bookings
        </p>
        <UInput
          v-model="query"
          icon="i-lucide-search"
          placeholder="Search reference, event or host"
          aria-label="Search bookings"
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
        variant="bookings"
        :rows="5"
        label="Loading bookings"
      />
      <AsyncErrorState
        v-else-if="blockingFailure"
        title="Could not load bookings"
        description="The booking list could not be loaded."
        :retrying="status === 'pending'"
        @retry="refresh"
      />
      <template v-else>
        <AsyncErrorState
          v-if="error"
          compact
          class="border-b border-default bg-error/5"
          title="Could not refresh bookings"
          description="The previous results are still shown."
          :retrying="refreshing"
          @retry="refresh"
        />
        <div
          v-if="bookings.length"
          :class="refreshing && 'opacity-60'"
        >
          <ul class="divide-y divide-default">
            <li
              v-for="booking in bookings"
              :key="booking.uid"
              class="flex flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:px-5"
            >
              <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-elevated text-muted"><UIcon
                name="i-lucide-calendar-days"
                class="size-4.5"
              /></span>
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="truncate text-[14px] font-semibold text-highlighted">
                    {{ booking.eventTypeTitle }}
                  </p>
                  <span class="rounded-full bg-elevated px-2 py-0.5 text-[11px] font-medium capitalize text-muted">{{ booking.status.replace('_', ' ') }}</span>
                </div>
                <p class="mt-1 truncate text-[12px] text-muted">
                  {{ booking.uid }} · {{ booking.organizationName || 'Personal' }}
                </p>
                <p class="mt-1 text-[12px] text-dimmed">
                  Created {{ formatDateTime(booking.createdAt) }}
                </p>
              </div>
              <div class="sm:w-56">
                <p class="text-[12px] text-dimmed">
                  Host
                </p>
                <NuxtLink
                  :to="`/control/users/${booking.hostId}`"
                  class="mt-1 block truncate text-[13px] font-medium text-toned hover:text-highlighted"
                >{{ booking.hostName }}</NuxtLink>
                <p class="truncate text-[12px] text-muted">
                  {{ booking.hostEmail }}
                </p>
              </div>
              <div class="sm:w-44 sm:text-right">
                <p class="text-[12px] text-dimmed">
                  Meeting time
                </p>
                <p class="tnum mt-1 text-[13px] font-medium text-toned">
                  {{ formatDateTime(booking.startsAt) }}
                </p>
              </div>
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
          icon="i-lucide-calendar-days"
          :title="query ? 'No matching bookings' : 'No bookings yet'"
          :description="query ? 'Try another reference, event type, host or team.' : 'Bookings will appear here.'"
        />
      </template>
    </section>
  </div>
</template>
