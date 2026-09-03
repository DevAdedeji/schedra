<script setup lang="ts">
import { controlApi, type ControlUserDetail } from '~/services/schedra-api'
import { formatDateTime } from '~/utils/date-time'

definePageMeta({ layout: 'app', middleware: ['auth', 'platform-admin'] })
useSeoMeta({ title: 'User · Control', robots: 'noindex, nofollow' })

const route = useRoute()
const requestFetch = useRequestFetch()
const userId = computed(() => String(route.params.id ?? ''))
const { data, status, error, refresh } = await useAsyncData(
  () => `control-user-${userId.value}`,
  (_nuxtApp, { signal }) => requestFetch<ControlUserDetail>(controlApi.userEndpoint(userId.value), { signal }),
  { watch: [userId] }
)

const planLabel = computed(() => data.value?.user.subscriptionStatus === 'free'
  ? 'Free'
  : `${data.value?.user.subscriptionStatus}${data.value?.user.subscriptionInterval ? ` · ${data.value.user.subscriptionInterval}` : ''}`)
const countCards = computed(() => data.value
  ? [
      { label: 'Teams', value: data.value.counts.teams },
      { label: 'Event types', value: data.value.counts.eventTypes },
      { label: 'Bookings', value: data.value.counts.bookings },
      { label: 'Integrations', value: data.value.counts.integrations }
    ]
  : [])

function bookingCountLabel(value: number) {
  return `${value} ${value === 1 ? 'booking' : 'bookings'}`
}
</script>

<template>
  <div>
    <ControlNavigation />
    <UButton
      to="/control/users"
      label="Back to users"
      icon="i-lucide-arrow-left"
      color="neutral"
      variant="ghost"
      class="mb-4"
    />

    <AsyncErrorState
      v-if="error && !data"
      title="Could not load this user"
      description="The account may no longer exist, or its details could not be loaded."
      :retrying="status === 'pending'"
      @retry="refresh"
    />

    <template v-else-if="data">
      <PageHeader
        :title="data.user.name"
        :description="`${data.user.email} · /${data.user.username}`"
      >
        <template #actions>
          <UButton
            :to="`/${data.user.username}`"
            target="_blank"
            label="Public page"
            icon="i-lucide-external-link"
            color="neutral"
            variant="outline"
          />
        </template>
      </PageHeader>

      <div class="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div
          v-for="card in countCards"
          :key="card.label"
          class="rounded-xl border border-default bg-default p-5"
        >
          <p class="text-[12px] font-medium uppercase tracking-wide text-dimmed">
            {{ card.label }}
          </p>
          <p class="tnum mt-2 text-[28px] font-semibold capitalize text-highlighted">
            {{ card.value }}
          </p>
        </div>
      </div>

      <div class="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div class="space-y-6">
          <section class="overflow-hidden rounded-xl border border-default bg-default">
            <div class="border-b border-default px-5 py-4">
              <h2 class="text-[16px] font-semibold text-highlighted">
                Event types
              </h2>
              <p class="mt-1 text-[13px] text-muted">
                Personal links and team links this user can host.
              </p>
            </div>
            <ul
              v-if="data.eventTypes.length"
              class="divide-y divide-default"
            >
              <li
                v-for="eventType in data.eventTypes"
                :key="eventType.id"
                class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
              >
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="truncate text-[14px] font-medium text-highlighted">
                      {{ eventType.title }}
                    </p>
                    <span class="rounded-full bg-elevated px-2 py-0.5 text-[11px] font-medium capitalize text-muted">{{ eventType.scope }}</span>
                    <span
                      v-if="eventType.hidden"
                      class="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning"
                    >Hidden</span>
                  </div>
                  <p class="mt-1 truncate text-[12px] text-muted">
                    {{ eventType.organizationName || `/${data.user.username}/${eventType.slug}` }}
                  </p>
                </div>
                <p class="tnum text-[12px] text-muted">
                  {{ eventType.durationMinutes }} min · {{ bookingCountLabel(eventType.bookingCount) }}
                </p>
              </li>
            </ul>
            <ListEmptyState
              v-else
              icon="i-lucide-link-2"
              title="No event types"
              description="This user does not own or host an event type."
            />
          </section>

          <section class="overflow-hidden rounded-xl border border-default bg-default">
            <div class="border-b border-default px-5 py-4">
              <h2 class="text-[16px] font-semibold text-highlighted">
                Recent bookings
              </h2>
              <p class="mt-1 text-[13px] text-muted">
                Operational metadata only; guest answers and contact details stay private.
              </p>
            </div>
            <ul
              v-if="data.recentBookings.length"
              class="divide-y divide-default"
            >
              <li
                v-for="booking in data.recentBookings"
                :key="booking.uid"
                class="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div class="min-w-0">
                  <p class="truncate text-[14px] font-medium text-highlighted">
                    {{ booking.eventTypeTitle }}
                  </p>
                  <p class="mt-1 text-[12px] text-muted">
                    {{ booking.uid }} · {{ booking.organizationName || 'Personal' }}
                  </p>
                </div>
                <div class="sm:text-right">
                  <p class="text-[12px] font-medium capitalize text-toned">
                    {{ booking.status.replace('_', ' ') }}
                  </p>
                  <p class="mt-1 text-[12px] text-dimmed">
                    {{ formatDateTime(booking.startsAt) }}
                  </p>
                </div>
              </li>
            </ul>
            <ListEmptyState
              v-else
              icon="i-lucide-calendar-days"
              title="No bookings"
              description="This user has not hosted a booking yet."
            />
          </section>
        </div>

        <div class="space-y-6">
          <section class="rounded-xl border border-default bg-default p-5">
            <h2 class="text-[16px] font-semibold text-highlighted">
              Account
            </h2>
            <dl class="mt-5 space-y-4 text-[13px]">
              <div>
                <dt class="text-dimmed">
                  Plan
                </dt><dd class="mt-1 font-medium capitalize text-highlighted">
                  {{ planLabel }}
                </dd>
              </div>
              <div>
                <dt class="text-dimmed">
                  Email
                </dt><dd class="mt-1 font-medium text-highlighted">
                  {{ data.user.emailVerified ? 'Verified' : 'Not verified' }}
                </dd>
              </div>
              <div>
                <dt class="text-dimmed">
                  Two-factor authentication
                </dt><dd class="mt-1 font-medium text-highlighted">
                  {{ data.user.twoFactorEnabled ? 'Enabled' : 'Not enabled' }}
                </dd>
              </div>
              <div>
                <dt class="text-dimmed">
                  Sign-in methods
                </dt><dd class="mt-1 font-medium capitalize text-highlighted">
                  {{ data.authProviders.join(', ') || 'None' }}
                </dd>
              </div>
              <div>
                <dt class="text-dimmed">
                  Time zone
                </dt><dd class="mt-1 font-medium text-highlighted">
                  {{ data.user.timeZone }}
                </dd>
              </div>
              <div>
                <dt class="text-dimmed">
                  Joined
                </dt><dd class="mt-1 font-medium text-highlighted">
                  {{ formatDateTime(data.user.createdAt) }}
                </dd>
              </div>
            </dl>
          </section>

          <section class="rounded-xl border border-default bg-default p-5">
            <h2 class="text-[16px] font-semibold text-highlighted">
              Integrations
            </h2>
            <ul
              v-if="data.integrations.length"
              class="mt-4 space-y-3"
            >
              <li
                v-for="integration in data.integrations"
                :key="`${integration.kind}-${integration.provider}`"
                class="rounded-lg bg-elevated/60 px-3 py-3"
              >
                <div class="flex items-center justify-between gap-2">
                  <p class="text-[13px] font-medium capitalize text-highlighted">
                    {{ integration.provider }}
                  </p>
                  <span class="text-[11px] font-medium capitalize text-muted">{{ integration.status.replace('_', ' ') }}</span>
                </div>
                <p
                  v-if="integration.accountLabel"
                  class="mt-1 truncate text-[12px] text-muted"
                >
                  {{ integration.accountLabel }}
                </p>
              </li>
            </ul>
            <p
              v-else
              class="mt-3 text-[13px] text-muted"
            >
              No calendar or video integrations.
            </p>
          </section>

          <section class="rounded-xl border border-default bg-default p-5">
            <h2 class="text-[16px] font-semibold text-highlighted">
              Teams
            </h2>
            <ul
              v-if="data.teams.length"
              class="mt-4 space-y-3"
            >
              <li
                v-for="team in data.teams"
                :key="team.id"
                class="rounded-lg bg-elevated/60 px-3 py-3"
              >
                <p class="truncate text-[13px] font-medium text-highlighted">
                  {{ team.name }}
                </p>
                <p class="mt-1 text-[12px] capitalize text-muted">
                  {{ team.role }} · {{ team.subscriptionStatus }}
                </p>
              </li>
            </ul>
            <p
              v-else
              class="mt-3 text-[13px] text-muted"
            >
              Not a member of any team.
            </p>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>
