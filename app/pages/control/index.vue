<script setup lang="ts">
import { controlApi, type ControlOverview } from '~/services/schedra-api'
import { formatDateTime } from '~/utils/date-time'

definePageMeta({ layout: 'app', middleware: ['auth', 'platform-admin'] })
useSeoMeta({ title: 'Control', robots: 'noindex, nofollow' })

const requestFetch = useRequestFetch()
const { data, status, error, refresh } = await useAsyncData(
  'control-overview',
  (_nuxtApp, { signal }) => requestFetch<ControlOverview>(controlApi.overviewEndpoint, { signal })
)

const stats = computed(() => data.value
  ? [
      { label: 'Users', value: data.value.users.total, detail: `${data.value.users.joinedLastThirtyDays} joined in 30 days`, icon: 'i-lucide-users', to: '/control/users' },
      { label: 'Event types', value: data.value.eventTypes.total, detail: `${data.value.eventTypes.visible} public`, icon: 'i-lucide-link-2', to: '/control/event-types' },
      { label: 'Bookings', value: data.value.bookings.total, detail: `${data.value.bookings.createdLastThirtyDays} created in 30 days`, icon: 'i-lucide-calendar-days', to: '/control/bookings' },
      { label: 'Teams', value: data.value.organizations.total, detail: `${data.value.organizations.active} active`, icon: 'i-lucide-building-2', to: '/control/teams' }
    ]
  : [])
</script>

<template>
  <div>
    <ControlNavigation />
    <PageHeader
      title="Control"
      description="A private view of Schedra accounts, activity and system health."
    >
      <template #actions>
        <UButton
          label="Refresh"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          :loading="status === 'pending'"
          @click="refresh()"
        />
      </template>
    </PageHeader>

    <AsyncErrorState
      v-if="error && !data"
      class="mt-7"
      title="Could not load Control"
      description="The private account summary could not be loaded."
      :retrying="status === 'pending'"
      @retry="refresh"
    />

    <template v-else>
      <div class="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <NuxtLink
          v-for="stat in stats"
          :key="stat.label"
          :to="stat.to"
          class="group rounded-xl border border-default bg-default p-5 transition-colors hover:bg-elevated/50"
        >
          <div class="flex items-center justify-between gap-3">
            <span class="flex size-9 items-center justify-center rounded-lg bg-elevated text-muted group-hover:text-highlighted">
              <UIcon
                :name="stat.icon"
                class="size-4.5"
              />
            </span>
            <UIcon
              name="i-lucide-arrow-up-right"
              class="size-4 text-dimmed"
            />
          </div>
          <p class="tnum mt-5 text-[30px] font-semibold leading-none text-highlighted">
            {{ stat.value }}
          </p>
          <p class="mt-2 text-[14px] font-medium text-highlighted">
            {{ stat.label }}
          </p>
          <p class="mt-1 text-[13px] text-muted">
            {{ stat.detail }}
          </p>
        </NuxtLink>
      </div>

      <div class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section class="overflow-hidden rounded-xl border border-default bg-default">
          <div class="flex items-center justify-between gap-4 border-b border-default px-5 py-4">
            <div>
              <h2 class="text-[16px] font-semibold text-highlighted">
                Newest users
              </h2>
              <p class="mt-1 text-[13px] text-muted">
                The five most recently created accounts.
              </p>
            </div>
            <UButton
              to="/control/users"
              label="View all"
              color="neutral"
              variant="ghost"
              size="sm"
            />
          </div>
          <div
            v-if="status === 'pending' && !data"
            class="space-y-3 p-5"
            aria-label="Loading users"
          >
            <USkeleton
              v-for="index in 4"
              :key="index"
              class="h-12 w-full"
            />
          </div>
          <ul
            v-else-if="data?.recentUsers.length"
            class="divide-y divide-default"
          >
            <li
              v-for="user in data.recentUsers"
              :key="user.id"
            >
              <NuxtLink
                :to="`/control/users/${user.id}`"
                class="flex items-center gap-3 px-5 py-4 hover:bg-elevated/40"
              >
                <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-elevated text-[13px] font-semibold text-toned">
                  {{ user.name.slice(0, 1).toUpperCase() }}
                </span>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-[14px] font-medium text-highlighted">{{ user.name }}</p>
                  <p class="truncate text-[12px] text-muted">{{ user.email }}</p>
                </div>
                <time class="hidden text-[12px] text-dimmed sm:block">{{ formatDateTime(user.createdAt) }}</time>
              </NuxtLink>
            </li>
          </ul>
          <ListEmptyState
            v-else
            title="No users yet"
            description="New accounts will appear here."
            icon="i-lucide-users"
          />
        </section>

        <section class="rounded-xl border border-default bg-default p-5">
          <h2 class="text-[16px] font-semibold text-highlighted">
            Account health
          </h2>
          <p class="mt-1 text-[13px] text-muted">
            Authentication and paid access at a glance.
          </p>
          <dl class="mt-5 space-y-4">
            <div class="flex items-center justify-between gap-3">
              <dt class="text-[13px] text-muted">
                Verified emails
              </dt>
              <dd class="tnum text-[14px] font-semibold text-highlighted">
                {{ data?.users.verified ?? 0 }}
              </dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="text-[13px] text-muted">
                2FA enabled
              </dt>
              <dd class="tnum text-[14px] font-semibold text-highlighted">
                {{ data?.users.twoFactor ?? 0 }}
              </dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="text-[13px] text-muted">
                Personal subscriptions
              </dt>
              <dd class="tnum text-[14px] font-semibold text-highlighted">
                {{ data?.subscriptions.personal ?? 0 }}
              </dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="text-[13px] text-muted">
                Team subscriptions
              </dt>
              <dd class="tnum text-[14px] font-semibold text-highlighted">
                {{ data?.subscriptions.teams ?? 0 }}
              </dd>
            </div>
          </dl>
          <UButton
            to="/control/operations"
            label="Open system operations"
            icon="i-lucide-activity"
            color="neutral"
            variant="soft"
            block
            class="mt-6"
          />
        </section>
      </div>
    </template>
  </div>
</template>
