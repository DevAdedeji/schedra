<script setup lang="ts">
import { controlApi, type ControlListResponse, type ControlUserRecord } from '~/services/schedra-api'
import { DEFAULT_LIST_PAGE_SIZE } from '~/constants/lists'
import { formatDate } from '~/utils/date-time'
import { getInitials } from '~/utils/text'

definePageMeta({ layout: 'app', middleware: ['auth', 'platform-admin'] })
useSeoMeta({ title: 'Users · Control', robots: 'noindex, nofollow' })

const { query, search, page } = useListQueryState()
const apiQuery = computed(() => ({ page: page.value, pageSize: DEFAULT_LIST_PAGE_SIZE, search: search.value }))
const { data, status, error, refresh } = await useLazyFetch<ControlListResponse<ControlUserRecord>>(
  controlApi.usersEndpoint,
  { query: apiQuery }
)
const { initialLoading, refreshing, blockingFailure } = useListLoadingState(status, data, error)
const users = computed(() => data.value?.items ?? [])
</script>

<template>
  <div>
    <ControlNavigation />
    <PageHeader
      title="Users"
      description="Search accounts and inspect the product data attached to each user."
    />

    <section class="mt-7 overflow-hidden rounded-xl border border-default bg-default">
      <div class="surface-secondary flex flex-col gap-3 border-b border-default px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <p class="text-[13px] text-muted">
          {{ data?.pagination.total ?? 0 }} total accounts
        </p>
        <UInput
          v-model="query"
          icon="i-lucide-search"
          placeholder="Search name, email or username"
          aria-label="Search users"
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
        label="Loading users"
      />
      <AsyncErrorState
        v-else-if="blockingFailure"
        title="Could not load users"
        description="The account list could not be loaded."
        :retrying="status === 'pending'"
        @retry="refresh"
      />
      <template v-else>
        <AsyncErrorState
          v-if="error"
          compact
          class="border-b border-default bg-error/5"
          title="Could not refresh users"
          description="The previous account list is still shown."
          :retrying="refreshing"
          @retry="refresh"
        />

        <div
          v-if="users.length"
          :class="refreshing && 'opacity-60'"
        >
          <ul class="divide-y divide-default">
            <li
              v-for="user in users"
              :key="user.id"
            >
              <NuxtLink
                :to="`/control/users/${user.id}`"
                class="flex flex-col gap-4 px-4 py-5 transition-colors hover:bg-elevated/40 sm:flex-row sm:items-center sm:px-5"
              >
                <div class="flex min-w-0 flex-1 items-center gap-3">
                  <span class="flex size-10 shrink-0 items-center justify-center rounded-full bg-elevated text-[13px] font-semibold text-toned">
                    {{ getInitials(user.name) }}
                  </span>
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <p class="truncate text-[14px] font-semibold text-highlighted">{{ user.name }}</p>
                      <span
                        v-if="user.emailVerified"
                        class="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success"
                      >Verified</span>
                      <span
                        v-else
                        class="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning"
                      >Unverified</span>
                    </div>
                    <p class="mt-0.5 truncate text-[13px] text-muted">{{ user.email }} · /{{ user.username }}</p>
                    <p class="mt-1 text-[12px] text-dimmed">Joined {{ formatDate(user.createdAt) }} · {{ user.providers.join(', ') || 'No auth provider' }}</p>
                  </div>
                </div>
                <dl class="grid grid-cols-4 gap-4 pl-[3.25rem] sm:w-[25rem] sm:pl-0">
                  <div>
                    <dt class="text-[11px] uppercase tracking-wide text-dimmed">Plan</dt>
                    <dd class="mt-1 truncate text-[13px] font-medium capitalize text-toned">{{ user.subscriptionStatus }}</dd>
                  </div>
                  <div>
                    <dt class="text-[11px] uppercase tracking-wide text-dimmed">Events</dt>
                    <dd class="tnum mt-1 text-[13px] font-medium text-toned">{{ user.eventTypeCount }}</dd>
                  </div>
                  <div>
                    <dt class="text-[11px] uppercase tracking-wide text-dimmed">Bookings</dt>
                    <dd class="tnum mt-1 text-[13px] font-medium text-toned">{{ user.bookingCount }}</dd>
                  </div>
                  <div>
                    <dt class="text-[11px] uppercase tracking-wide text-dimmed">Teams</dt>
                    <dd class="tnum mt-1 text-[13px] font-medium text-toned">{{ user.teamCount }}</dd>
                  </div>
                </dl>
                <UIcon
                  name="i-lucide-chevron-right"
                  class="hidden size-4 shrink-0 text-dimmed sm:block"
                />
              </NuxtLink>
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
          icon="i-lucide-users"
          :title="query ? 'No matching users' : 'No users yet'"
          :description="query ? 'Try another name, email or username.' : 'New accounts will appear here.'"
        />
      </template>
    </section>
  </div>
</template>
