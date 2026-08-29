<script setup lang="ts">
import { teamAuditApi, teamsApi, type TeamAuditResponse, type TeamDetail } from '~/services/schedra-api'

definePageMeta({ layout: 'app', middleware: 'auth' })

const route = useRoute()
const slug = computed(() => String(route.params.slug ?? ''))

const { data: team } = await useLazyFetch<TeamDetail>(() => teamsApi.detailEndpoint(slug.value))
useSeoMeta({
  title: () => team.value ? `${team.value.organization.name} activity log` : 'Team activity log',
  robots: 'noindex, nofollow'
})

const page = ref(1)
const { data, refresh, status, error: loadFailure } = await useLazyFetch<TeamAuditResponse>(
  () => teamAuditApi.listEndpoint(slug.value),
  { query: computed(() => ({ page: page.value, pageSize: 10 })) }
)

const list = computed(() => data.value?.items ?? [])
const initialLoading = computed(() => status.value === 'pending' && !data.value)
const refreshing = computed(() => status.value === 'pending' && Boolean(data.value))

// Every action the audit log records, said in plain language.
const PHRASES: Record<string, string> = {
  'organization.created': 'created this team',
  'organization.address_changed': 'changed the team address',
  'organization.ownership_transferred': 'transferred ownership',
  'organization.archived': 'archived this team',
  'invitation.sent': 'invited someone',
  'invitation.accepted': 'joined the team',
  'invitation.rejected': 'declined an invitation',
  'invitation.revoked': 'revoked an invitation',
  'member.role_changed': 'changed a role',
  'member.removed': 'removed a member',
  'event_type.created': 'created an event type',
  'event_type.updated': 'updated an event type',
  'event_type.deleted': 'deleted an event type',
  'billing.checkout_opened': 'started a checkout',
  'billing.invoice_paid': 'paid an invoice'
}

function phrase(action: string) {
  return PHRASES[action] ?? action.replace(/[._]/g, ' ')
}

function detail(entry: TeamAuditResponse['items'][number]) {
  const meta = entry.metadata ?? {}
  const parts: string[] = []
  for (const key of ['email', 'to', 'from', 'slug', 'role', 'name', 'previousOwner']) {
    const value = meta[key]
    if (typeof value === 'string' && value) parts.push(`${key}: ${value}`)
  }
  return parts.join(' · ')
}

const icons: Record<string, string> = {
  organization: 'i-lucide-building-2',
  invitation: 'i-lucide-mail',
  member: 'i-lucide-users',
  event_type: 'i-lucide-link-2',
  billing: 'i-lucide-credit-card'
}

function icon(action: string) {
  return icons[action.split('.')[0] ?? ''] ?? 'i-lucide-activity'
}

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  })
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="Activity log"
      description="Who changed what in this team, and when."
    />

    <section class="overflow-hidden rounded-xl border border-default bg-default">
      <AsyncErrorState
        v-if="loadFailure && !data"
        title="Could not load the activity log"
        description="Only owners and admins can see this."
        @retry="refresh"
      />

      <ListLoadingSkeleton
        v-else-if="initialLoading"
        label="Loading activity"
      />

      <ListEmptyState
        v-else-if="!list.length"
        icon="i-lucide-activity"
        title="Nothing recorded yet"
        description="Membership and billing changes will show up here as they happen."
      />

      <ul
        v-else
        class="divide-y divide-default"
        :class="refreshing && 'opacity-60'"
      >
        <li
          v-for="entry in list"
          :key="entry.id"
          class="flex items-start gap-3 px-4 py-3.5 sm:px-5"
        >
          <span class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-elevated text-dimmed">
            <UIcon
              :name="icon(entry.action)"
              class="size-3.5"
            />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-[14px] text-highlighted">
              <span class="font-medium">{{ entry.actorName ?? entry.actorEmail ?? 'Schedra' }}</span>
              {{ phrase(entry.action) }}
            </p>
            <p class="mt-0.5 text-[12px] text-muted">
              {{ when(entry.createdAt) }}<template v-if="detail(entry)">
                · {{ detail(entry) }}
              </template>
            </p>
          </div>
        </li>
      </ul>

      <ListPagination
        :page="data?.pagination.page ?? 1"
        :total-pages="data?.pagination.totalPages ?? 1"
        :total="data?.pagination.total ?? 0"
        :page-size="data?.pagination.pageSize"
        :disabled="refreshing"
        @change="page = $event"
      />
    </section>
  </div>
</template>
