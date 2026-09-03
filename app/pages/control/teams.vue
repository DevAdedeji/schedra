<script setup lang="ts">
import { controlApi, type ControlListResponse, type ControlTeamRecord } from '~/services/schedra-api'
import { DEFAULT_LIST_PAGE_SIZE } from '~/constants/lists'
import { formatDate } from '~/utils/date-time'

definePageMeta({ layout: 'app', middleware: ['auth', 'platform-admin'] })
useSeoMeta({ title: 'Teams · Control', robots: 'noindex, nofollow' })

const { query, search, page } = useListQueryState()
const apiQuery = computed(() => ({ page: page.value, pageSize: DEFAULT_LIST_PAGE_SIZE, search: search.value }))
const { data, status, error, refresh } = await useLazyFetch<ControlListResponse<ControlTeamRecord>>(
  controlApi.teamsEndpoint,
  { query: apiQuery }
)
const { initialLoading, refreshing, blockingFailure } = useListLoadingState(status, data, error)
const teams = computed(() => data.value?.items ?? [])
</script>

<template>
  <div>
    <ControlNavigation />
    <PageHeader
      title="Teams"
      description="See team ownership, membership, usage and subscription state."
    />

    <section class="mt-7 overflow-hidden rounded-xl border border-default bg-default">
      <div class="surface-secondary flex flex-col gap-3 border-b border-default px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <p class="text-[13px] text-muted">
          {{ data?.pagination.total ?? 0 }} total teams
        </p>
        <UInput
          v-model="query"
          icon="i-lucide-search"
          placeholder="Search team name or slug"
          aria-label="Search teams"
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
        label="Loading teams"
      />
      <AsyncErrorState
        v-else-if="blockingFailure"
        title="Could not load teams"
        description="The team list could not be loaded."
        :retrying="status === 'pending'"
        @retry="refresh"
      />
      <template v-else>
        <AsyncErrorState
          v-if="error"
          compact
          class="border-b border-default bg-error/5"
          title="Could not refresh teams"
          description="The previous results are still shown."
          :retrying="refreshing"
          @retry="refresh"
        />
        <div
          v-if="teams.length"
          :class="refreshing && 'opacity-60'"
        >
          <ul class="divide-y divide-default">
            <li
              v-for="team in teams"
              :key="team.id"
              class="flex flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:px-5"
            >
              <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-elevated text-muted"><UIcon
                name="i-lucide-building-2"
                class="size-4.5"
              /></span>
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="truncate text-[14px] font-semibold text-highlighted">
                    {{ team.name }}
                  </p>
                  <span
                    v-if="team.archivedAt"
                    class="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning"
                  >Archived</span>
                  <span
                    v-else
                    class="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success"
                  >Active</span>
                </div>
                <p class="mt-1 truncate text-[12px] text-muted">
                  /{{ team.slug }} · {{ team.ownerName || 'No owner' }}<span v-if="team.ownerEmail"> · {{ team.ownerEmail }}</span>
                </p>
                <p class="mt-1 text-[12px] text-dimmed">
                  Created {{ formatDate(team.createdAt) }}
                </p>
              </div>
              <dl class="grid grid-cols-4 gap-5 sm:w-[24rem]">
                <div>
                  <dt class="text-[11px] uppercase tracking-wide text-dimmed">
                    Plan
                  </dt><dd class="mt-1 truncate text-[13px] font-medium capitalize text-toned">
                    {{ team.subscriptionStatus }}
                  </dd>
                </div>
                <div>
                  <dt class="text-[11px] uppercase tracking-wide text-dimmed">
                    Members
                  </dt><dd class="tnum mt-1 text-[13px] font-medium text-toned">
                    {{ team.memberCount }}
                  </dd>
                </div>
                <div>
                  <dt class="text-[11px] uppercase tracking-wide text-dimmed">
                    Events
                  </dt><dd class="tnum mt-1 text-[13px] font-medium text-toned">
                    {{ team.eventTypeCount }}
                  </dd>
                </div>
                <div>
                  <dt class="text-[11px] uppercase tracking-wide text-dimmed">
                    Bookings
                  </dt><dd class="tnum mt-1 text-[13px] font-medium text-toned">
                    {{ team.bookingCount }}
                  </dd>
                </div>
              </dl>
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
          icon="i-lucide-building-2"
          :title="query ? 'No matching teams' : 'No teams yet'"
          :description="query ? 'Try another name or slug.' : 'Created teams will appear here.'"
        />
      </template>
    </section>
  </div>
</template>
