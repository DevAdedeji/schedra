<script setup lang="ts">
import {
  apiErrorMessage,
  teamEventTypesApi,
  teamsApi,
  type TeamDetail,
  type TeamEventTypeRecord,
  type TeamEventTypesResponse,
  type TeamMembersResponse
} from '~/services/schedra-api'
import { formatMoney } from '#shared/payments'

definePageMeta({ layout: 'app', middleware: 'auth' })

const route = useRoute()
const slug = computed(() => String(route.params.slug ?? ''))
const feedback = useFeedback()
const { host, url: siteUrl } = useSiteUrl()
const { copy } = useCopy()

const { data: team } = await useLazyFetch<TeamDetail>(() => teamsApi.detailEndpoint(slug.value))

useSeoMeta({
  title: () => team.value ? `${team.value.organization.name} event types` : 'Team event types',
  robots: 'noindex, nofollow'
})

const filter = ref<'all' | 'active' | 'hidden'>('all')
const page = ref(1)
const listQuery = computed(() => ({ filter: filter.value, page: page.value, pageSize: 10 }))

const { data, refresh, status, error: loadFailure }
  = await useLazyFetch<TeamEventTypesResponse>(() => teamEventTypesApi.listEndpoint(slug.value), { query: listQuery })

const memberPage = ref(1)
const memberSearchInput = ref('')
const memberSearch = ref('')
let memberSearchTimer: ReturnType<typeof setTimeout> | undefined

watch(memberSearchInput, (value) => {
  clearTimeout(memberSearchTimer)
  memberSearchTimer = setTimeout(() => {
    memberSearch.value = value.trim()
    memberPage.value = 1
  }, 250)
})
onBeforeUnmount(() => clearTimeout(memberSearchTimer))

const membersQuery = computed(() => ({
  page: memberPage.value,
  pageSize: 10,
  search: memberSearch.value
}))
const {
  data: members,
  status: membersStatus,
  error: membersFailure,
  refresh: refreshMembers
} = await useFetch<TeamMembersResponse>(
  () => teamsApi.membersEndpoint(slug.value),
  { query: membersQuery }
)

const list = computed(() => data.value?.items ?? [])
const memberList = computed(() => members.value?.items ?? [])
const permissions = computed(() => team.value?.permissions)
const initialLoading = computed(() => status.value === 'pending' && !data.value)
const refreshing = computed(() => status.value === 'pending' && Boolean(data.value))

watch(filter, () => {
  page.value = 1
})

const filterOptions = computed(() => [
  { value: 'all', label: 'All', count: data.value?.counts.all ?? 0 },
  { value: 'active', label: 'Active', count: data.value?.counts.active ?? 0 },
  { value: 'hidden', label: 'Hidden', count: data.value?.counts.hidden ?? 0 }
])

const editing = ref<TeamEventTypeRecord | null>(null)
const modalOpen = ref(false)
const busyId = ref('')
const embedOpen = ref(false)
const embeddingItem = ref<TeamEventTypeRecord | null>(null)

function create() {
  editing.value = null
  modalOpen.value = true
}

function edit(eventType: TeamEventTypeRecord) {
  editing.value = eventType
  modalOpen.value = true
}

function showEmbed(eventType: TeamEventTypeRecord) {
  embeddingItem.value = eventType
  embedOpen.value = true
}

const assignmentLabel: Record<string, string> = {
  single: 'One host',
  round_robin: 'Round robin',
  collective: 'Everyone'
}

function publicUrl(eventType: TeamEventTypeRecord) {
  return `${siteUrl.value}/team/${slug.value}/${eventType.slug}`
}

async function remove(eventType: TeamEventTypeRecord) {
  busyId.value = eventType.id
  try {
    await teamEventTypesApi.remove(slug.value, eventType.id)
    feedback.success({ title: 'Event type deleted' })
    await refresh()
  } catch (failure) {
    feedback.error({ title: 'Could not delete', description: apiErrorMessage(failure, 'Please try again.') })
  } finally {
    busyId.value = ''
  }
}

function actions(eventType: TeamEventTypeRecord) {
  const items = [{
    label: 'Copy link',
    icon: 'i-lucide-link',
    onSelect: async () => {
      const written = await copy(publicUrl(eventType))
      if (written) feedback.success({ title: 'Booking link copied' })
      else feedback.error({ title: 'Could not copy', description: 'Copy it from the address shown instead.' })
    }
  }, {
    label: 'Embed on website',
    icon: 'i-lucide-code-xml',
    onSelect: async () => { showEmbed(eventType) }
  }]

  if (permissions.value?.manageEventTypes) {
    items.push({
      label: 'Edit',
      icon: 'i-lucide-pencil',
      onSelect: async () => { edit(eventType) }
    })
    items.push({
      label: 'Delete',
      icon: 'i-lucide-trash-2',
      onSelect: async () => { await remove(eventType) }
    })
  }

  return [items]
}

/** A team event with nobody active cannot be booked, so say so loudly. */
function activeHosts(eventType: TeamEventTypeRecord) {
  return eventType.hosts.filter(host => host.enabled)
}
</script>

<template>
  <div class="space-y-6">
    <PageHeader
      title="Team event types"
      description="Shared booking links. Each host keeps their own hours and calendar."
    >
      <template #actions>
        <UButton
          v-if="permissions?.manageEventTypes"
          icon="i-lucide-plus"
          @click="create"
        >
          New event type
        </UButton>
      </template>
    </PageHeader>

    <section class="overflow-hidden rounded-xl border border-default bg-default">
      <div class="border-b border-default px-4 py-3 sm:px-5">
        <ListFilter
          v-model="filter"
          :options="filterOptions"
          :disabled="refreshing"
        />
      </div>

      <AsyncErrorState
        v-if="loadFailure && !data"
        title="Could not load event types"
        @retry="refresh"
      />

      <ListLoadingSkeleton
        v-else-if="initialLoading"
        label="Loading event types"
      />

      <ListEmptyState
        v-else-if="!list.length"
        icon="i-lucide-link-2"
        title="No team event types yet"
        description="Create one and your whole team can host it from a single link."
      >
        <template
          v-if="permissions?.manageEventTypes"
          #action
        >
          <UButton
            icon="i-lucide-plus"
            @click="create"
          >
            New event type
          </UButton>
        </template>
      </ListEmptyState>

      <ul
        v-else
        class="divide-y divide-default"
        :class="refreshing && 'opacity-60'"
      >
        <li
          v-for="eventType in list"
          :key="eventType.id"
          class="flex items-start gap-4 px-4 py-4 sm:px-5"
        >
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <p class="truncate text-[14px] font-medium text-highlighted">
                {{ eventType.title }}
              </p>
              <UBadge
                color="neutral"
                variant="subtle"
                size="sm"
              >
                {{ eventType.durationMinutes }} min
              </UBadge>
              <UBadge
                color="info"
                variant="subtle"
                size="sm"
              >
                {{ assignmentLabel[eventType.assignmentMode] }}
              </UBadge>
              <UBadge
                v-if="eventType.capacity > 1"
                color="neutral"
                variant="subtle"
                size="sm"
              >
                {{ eventType.capacity }} seats
              </UBadge>
              <UBadge
                v-if="eventType.paymentEnabled && eventType.priceCents"
                color="success"
                variant="subtle"
                size="sm"
              >
                {{ formatMoney(eventType.priceCents, eventType.paymentCurrency) }}
              </UBadge>
              <UBadge
                v-if="eventType.hidden"
                color="neutral"
                variant="subtle"
                size="sm"
              >
                hidden
              </UBadge>
            </div>

            <p class="mt-1 truncate text-[12px] text-muted">
              {{ host }}/team/{{ slug }}/{{ eventType.slug }}
            </p>

            <p
              v-if="!activeHosts(eventType).length"
              class="mt-1.5 text-[12px] text-error"
            >
              No active hosts — this link cannot be booked until someone is added.
            </p>
            <p
              v-else
              class="mt-1.5 text-[12px] text-muted"
            >
              {{ activeHosts(eventType).map(entry => entry.name).join(', ') }}
            </p>
          </div>

          <UDropdownMenu
            :items="actions(eventType)"
            :ui="{ content: 'w-44', item: 'gap-2 px-2.5 py-2 text-[13px]' }"
          >
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-ellipsis"
              class="size-7 justify-center p-0"
              :loading="busyId === eventType.id"
              :aria-label="`Actions for ${eventType.title}`"
            />
          </UDropdownMenu>
        </li>
      </ul>

      <ListPagination
        :page="data?.pagination.page ?? 1"
        :total-pages="data?.pagination.totalPages ?? 1"
        :total="data?.pagination.total ?? 0"
        :disabled="refreshing"
        @change="page = $event"
      />
    </section>

    <TeamEventTypeModal
      v-model:open="modalOpen"
      v-model:member-page="memberPage"
      v-model:member-search="memberSearchInput"
      :team-slug="slug"
      :members="memberList"
      :member-total="members?.pagination.total ?? 0"
      :member-total-pages="members?.pagination.totalPages ?? 1"
      :members-loading="membersStatus === 'pending'"
      :members-error="Boolean(membersFailure)"
      :event-type="editing"
      @retry-members="refreshMembers"
      @saved="() => refresh()"
    />

    <EmbedCodeModal
      v-if="embeddingItem"
      v-model:open="embedOpen"
      :booking-url="publicUrl(embeddingItem)"
      :title="embeddingItem.title"
    />
  </div>
</template>
