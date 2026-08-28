<script setup lang="ts">
import { apiErrorMessage, eventTypesApi, type EventTypesResponse } from '~/services/schedra-api'
import type { EventTypeRecord } from '~/types/event-type'
import { compactActionMenuUi } from '~/utils/action-menu'
import { formatMoney } from '#shared/payments'

definePageMeta({ layout: 'app', middleware: 'auth' })
useSeoMeta({ title: 'Event types', robots: 'noindex, nofollow' })

const query = ref('')
const search = ref('')
const filter = ref<'all' | 'active' | 'hidden'>('all')
const page = ref(1)
const apiQuery = computed(() => ({ filter: filter.value, search: search.value, page: page.value, pageSize: 10 }))
const { data, refresh, status, error: loadFailure } = await useLazyFetch<EventTypesResponse>(eventTypesApi.listEndpoint, { query: apiQuery })
const { data: currentUser } = await useCurrentUser()
const { host, url: siteUrl } = useSiteUrl()
const feedback = useFeedback()
const route = useRoute()

const modalOpen = ref(false)
const selected = ref<EventTypeRecord | null>(null)
const deleteOpen = ref(false)
const deletingItem = ref<EventTypeRecord | null>(null)
const deleting = ref(false)
const deleteError = ref('')
const duplicating = ref<string | null>(null)
const embedOpen = ref(false)
const embeddingItem = ref<EventTypeRecord | null>(null)

const filters = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'hidden', label: 'Hidden' }
] as const

const filtered = computed(() => data.value?.items ?? [])
const counts = computed(() => data.value?.counts ?? { all: 0, active: 0, hidden: 0 })
const initialLoading = computed(() => status.value === 'pending' && !data.value)
const refreshing = computed(() => status.value === 'pending' && Boolean(data.value))
const blockingFailure = computed(() => Boolean(loadFailure.value && !data.value))

const filterOptions = computed(() => filters.map(option => ({
  ...option,
  count: counts.value[option.value]
})))

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(query, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    search.value = value.trim()
    page.value = 1
  }, 250)
})
watch(filter, () => {
  page.value = 1
})
onBeforeUnmount(() => clearTimeout(searchTimer))

function createNew() {
  selected.value = null
  modalOpen.value = true
}

onMounted(() => {
  if (route.query.create === '1') createNew()
})

function edit(item: EventTypeRecord) {
  selected.value = item
  modalOpen.value = true
}

function showEmbed(item: EventTypeRecord) {
  embeddingItem.value = item
  embedOpen.value = true
}

function mobileActions(item: EventTypeRecord) {
  return [
    ...(!item.hidden
      ? [{
          label: 'Embed on website',
          icon: 'i-lucide-code-xml',
          onSelect: () => showEmbed(item)
        }, {
          label: 'Preview booking page',
          icon: 'i-lucide-external-link',
          slot: 'preview',
          to: bookingPath(item),
          target: '_blank'
        }]
      : []),
    {
      label: 'Duplicate',
      icon: 'i-lucide-copy',
      onSelect: async () => { await duplicate(item) }
    },
    {
      label: 'Edit',
      icon: 'i-lucide-square-pen',
      onSelect: () => edit(item)
    },
    {
      label: 'Delete',
      icon: 'i-lucide-trash-2',
      color: 'error' as const,
      onSelect: () => requestDelete(item)
    }
  ].map(action => [action])
}

const embedBookingUrl = computed(() => embeddingItem.value
  ? `${siteUrl.value}${bookingPath(embeddingItem.value)}`
  : '')

function requestDelete(item: EventTypeRecord) {
  deletingItem.value = item
  deleteError.value = ''
  deleteOpen.value = true
}

async function confirmDelete() {
  if (!deletingItem.value) return
  const title = deletingItem.value.title
  deleting.value = true
  deleteError.value = ''
  try {
    await eventTypesApi.remove(deletingItem.value.id)
    await refresh()
    deleteOpen.value = false
    deletingItem.value = null
    feedback.success({ title: 'Event type deleted', description: `${title} is no longer bookable.` })
  } catch (failure) {
    deleteError.value = apiErrorMessage(failure, 'Could not delete this event type just now.')
  } finally {
    deleting.value = false
  }
}

async function saved(action: 'created' | 'updated') {
  await refresh()
  feedback.success({ title: action === 'created' ? 'Event type created' : 'Event type updated' })
}

async function duplicate(item: EventTypeRecord) {
  duplicating.value = item.id
  try {
    await eventTypesApi.duplicate(item.id)
    await refresh()
    feedback.success({
      title: 'Event type duplicated',
      description: 'The copy is hidden until you review and publish it.'
    })
  } catch (failure) {
    feedback.error({ title: 'Could not duplicate event type', description: apiErrorMessage(failure, 'Try again shortly.') })
  } finally {
    duplicating.value = null
  }
}

function bookingPath(item: EventTypeRecord) {
  return `/${currentUser.value?.user?.username ?? ''}/${item.slug}`
}

function noticeLabel(minutes: number) {
  if (!minutes) return 'No minimum notice'
  if (minutes % 1440 === 0) return `${minutes / 1440}d notice`
  if (minutes % 60 === 0) return `${minutes / 60}h notice`
  return `${minutes}m notice`
}

function locationLabel(item: EventTypeRecord) {
  if (item.locationType === 'google_meet') return 'Google Meet'
  if (item.locationType === 'zoom') return 'Zoom'
  if (item.locationType === 'video_link') return 'Video call'
  if (item.locationType === 'phone') return 'Phone call'
  if (item.locationType === 'in_person') return 'In person'
  return 'Custom location'
}

function locationIcon(item: EventTypeRecord) {
  if (item.locationType === 'google_meet') return 'i-simple-icons-googlemeet'
  if (item.locationType === 'zoom') return 'i-simple-icons-zoom'
  if (item.locationType === 'in_person') return 'i-lucide-map-pin'
  if (item.locationType === 'phone') return 'i-lucide-phone'
  return 'i-lucide-video'
}
</script>

<template>
  <div class="space-y-7">
    <PageHeader
      title="Event types"
      description="Design the meetings people can book with you."
    >
      <template #actions>
        <UButton
          icon="i-lucide-plus"
          size="lg"
          class="font-medium"
          @click="createNew"
        >
          New event type
        </UButton>
      </template>
    </PageHeader>

    <section class="overflow-hidden rounded-xl border border-default bg-default">
      <div class="surface-secondary flex flex-col gap-3 border-b border-default px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <ListFilter
          v-model="filter"
          :options="filterOptions"
          :disabled="initialLoading || refreshing"
        />

        <UInput
          v-model="query"
          icon="i-lucide-search"
          placeholder="Search event types"
          aria-label="Search event types"
          class="w-full sm:w-64"
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
        :rows="4"
        label="Loading event types"
      />

      <AsyncErrorState
        v-else-if="blockingFailure"
        title="Could not load event types"
        description="Your event types are safe. Check your connection and try loading them again."
        :retrying="status === 'pending'"
        @retry="refresh"
      />

      <template v-else>
        <AsyncErrorState
          v-if="loadFailure"
          compact
          class="border-b border-default bg-error/5"
          title="Could not refresh event types"
          description="The last loaded results are still shown below."
          :retrying="refreshing"
          @retry="refresh"
        />

        <div
          v-else-if="refreshing"
          class="surface-secondary flex items-center gap-2 border-b border-default px-4 py-2 text-[11px] text-muted sm:px-5"
          role="status"
          aria-live="polite"
        >
          <UIcon
            name="i-lucide-loader-circle"
            class="size-3.5 animate-spin text-primary"
          />
          Updating event types…
        </div>

        <ul
          v-if="filtered.length"
          class="divide-y divide-default"
        >
          <li
            v-for="item in filtered"
            :key="item.id"
            class="group relative transition-colors hover:bg-muted/60"
          >
            <button
              type="button"
              class="w-full px-4 py-5 text-left sm:px-5"
              @click="edit(item)"
            >
              <div class="flex items-start gap-4 sm:gap-5">
                <span class="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary"><UIcon
                  name="i-lucide-calendar-clock"
                  class="size-5"
                /></span>
                <div class="min-w-0 flex-1 pr-16 sm:pr-28">
                  <div class="flex flex-wrap items-center gap-2">
                    <h2 class="text-[15px] font-semibold text-highlighted sm:text-[16px]">
                      {{ item.title }}
                    </h2>
                    <span
                      v-if="item.hidden"
                      class="inline-flex items-center gap-1 rounded-full border border-default bg-muted px-2 py-0.5 text-[10px] font-medium text-muted"
                    ><UIcon
                      name="i-lucide-eye-off"
                      class="size-3"
                    />Hidden</span>
                    <span
                      v-else
                      class="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success"
                    ><span class="size-1.5 rounded-full bg-success" />Active</span>
                  </div>
                  <p
                    v-if="item.description"
                    class="mt-1.5 line-clamp-2 max-w-2xl text-[13px] leading-relaxed text-muted"
                  >
                    {{ item.description }}
                  </p>
                  <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-toned">
                    <span class="flex items-center gap-1.5"><UIcon
                      name="i-lucide-clock-3"
                      class="size-3.5 text-dimmed"
                    />{{ item.durationMinutes }} min</span>
                    <span
                      v-if="item.capacity > 1"
                      class="flex items-center gap-1.5"
                    ><UIcon
                      name="i-lucide-users"
                      class="size-3.5 text-dimmed"
                    />{{ item.capacity }} seats</span>
                    <span
                      v-if="item.paymentEnabled && item.priceCents"
                      class="flex items-center gap-1.5"
                    ><UIcon
                      name="i-lucide-credit-card"
                      class="size-3.5 text-dimmed"
                    />{{ formatMoney(item.priceCents, item.paymentCurrency) }}</span>
                    <span class="flex items-center gap-1.5"><UIcon
                      name="i-lucide-timer"
                      class="size-3.5 text-dimmed"
                    />{{ noticeLabel(item.minimumNoticeMinutes) }}</span>
                    <span
                      v-if="item.maxPerDay"
                      class="flex items-center gap-1.5"
                    ><UIcon
                      name="i-lucide-gauge"
                      class="size-3.5 text-dimmed"
                    />Up to {{ item.maxPerDay }} per day</span>
                    <span class="flex items-center gap-1.5"><UIcon
                      name="i-lucide-calendar-range"
                      class="size-3.5 text-dimmed"
                    />{{ item.scheduleName ?? 'Default schedule' }}</span>
                    <span class="flex items-center gap-1.5"><UIcon
                      :name="locationIcon(item)"
                      class="size-3.5 text-dimmed"
                    />{{ locationLabel(item) }}</span>
                    <span
                      v-if="item.reminderMinutes.length"
                      class="flex items-center gap-1.5"
                    ><UIcon
                      name="i-lucide-bell"
                      class="size-3.5 text-dimmed"
                    />{{ item.reminderMinutes.length }} reminder{{ item.reminderMinutes.length === 1 ? '' : 's' }}</span>
                    <span
                      v-if="item.requiresConfirmation"
                      class="flex items-center gap-1.5"
                    ><UIcon
                      name="i-lucide-shield-question"
                      class="size-3.5 text-dimmed"
                    />Approval required</span>
                  </div>
                  <p class="mt-3 truncate font-mono text-[11px] text-dimmed">
                    {{ host }}{{ bookingPath(item) }}
                  </p>
                </div>
              </div>
            </button>

            <div class="absolute right-3 top-4 sm:right-5 sm:top-5">
              <UDropdownMenu
                :items="mobileActions(item)"
                :ui="compactActionMenuUi"
                :external-icon="false"
              >
                <template #preview-trailing>
                  <UIcon
                    name="i-lucide-arrow-up-right"
                    class="size-3 text-dimmed"
                  />
                </template>
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-ellipsis"
                  class="size-7 justify-center p-0"
                  :loading="duplicating === item.id"
                  :ui="{ leadingIcon: 'size-3.5' }"
                  :aria-label="`Actions for ${item.title}`"
                  @click.stop
                />
              </UDropdownMenu>
            </div>
          </li>
        </ul>

        <ListEmptyState
          v-else-if="data?.counts.all"
          icon="i-lucide-search-x"
          title="No matching event types"
          description="Try another search or change the filter."
        >
          <template #action>
            <UButton
              color="neutral"
              variant="outline"
              size="sm"
              @click="query = ''; filter = 'all'"
            >
              Clear filters
            </UButton>
          </template>
        </ListEmptyState>

        <ListEmptyState
          v-else
          icon="i-lucide-link-2"
          title="Create something people can book"
          description="Set the duration, booking rules and link. Your weekly availability is applied automatically."
        >
          <template #action>
            <UButton
              icon="i-lucide-plus"
              class="font-medium"
              @click="createNew"
            >
              Create event type
            </UButton>
          </template>
        </ListEmptyState>

        <ListPagination
          v-if="data"
          :page="data.pagination.page"
          :total-pages="data.pagination.totalPages"
          :total="data.pagination.total"
          :disabled="refreshing"
          @change="page = $event"
        />
      </template>
    </section>

    <div class="flex items-start gap-3 rounded-xl border border-default bg-muted px-4 py-3.5 text-[12px] leading-relaxed text-muted">
      <UIcon
        name="i-lucide-shield-check"
        class="mt-0.5 size-4 shrink-0 text-primary"
      />
      Your booking links always respect your working hours, advance notice, break times and existing calendar conflicts.
    </div>

    <EventTypeModal
      v-model:open="modalOpen"
      :event-type="selected"
      @saved="saved"
    />

    <EmbedCodeModal
      v-if="embeddingItem"
      v-model:open="embedOpen"
      :booking-url="embedBookingUrl"
      :title="embeddingItem.title"
    />

    <UModal
      v-model:open="deleteOpen"
      title="Delete event type?"
      description="This cannot be undone."
    >
      <template #body>
        <p class="text-[14px] leading-relaxed text-muted">
          <span class="font-medium text-highlighted">{{ deletingItem?.title }}</span> will be removed from your account and its booking link will stop working.
        </p>
        <p
          v-if="deleteError"
          class="mt-4 rounded-lg border border-error/30 bg-error/10 px-3.5 py-3 text-[13px] text-error"
          role="alert"
        >
          {{ deleteError }}
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="deleting"
            @click="deleteOpen = false"
          >
            Keep event type
          </UButton>
          <UButton
            color="error"
            :loading="deleting"
            icon="i-lucide-trash-2"
            @click="confirmDelete"
          >
            Delete
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
