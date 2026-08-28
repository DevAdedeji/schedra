<script setup lang="ts">
import { apiErrorMessage, bookingLinksApi, type BookingLinkRecord, type BookingLinksResponse } from '~/services/schedra-api'
import { compactActionMenuUi } from '~/utils/action-menu'

definePageMeta({ layout: 'app', middleware: 'auth' })
useSeoMeta({ title: 'Meeting links', robots: 'noindex, nofollow' })

const filter = ref<'all' | 'available' | 'booked' | 'closed'>('all')
const page = ref(1)
const query = computed(() => ({ filter: filter.value, page: page.value, pageSize: 10 }))
const { data, status, error, refresh } = await useLazyFetch<BookingLinksResponse>(bookingLinksApi.listEndpoint, { query })
const feedback = useFeedback()
const modalOpen = ref(false)
const initialKind = ref<'single_use' | 'one_off'>('single_use')
const revokeOpen = ref(false)
const revoking = ref(false)
const revokeTarget = ref<BookingLinkRecord | null>(null)

const filters = computed(() => [
  { value: 'all', label: 'All', count: data.value?.counts.all ?? 0 },
  { value: 'available', label: 'Available', count: data.value?.counts.available ?? 0 },
  { value: 'booked', label: 'Booked', count: data.value?.counts.booked ?? 0 },
  { value: 'closed', label: 'Closed', count: data.value?.counts.closed ?? 0 }
])
const initialLoading = computed(() => status.value === 'pending' && !data.value)
const refreshing = computed(() => status.value === 'pending' && Boolean(data.value))

watch(filter, () => {
  page.value = 1
})

function openCreate(kind: 'single_use' | 'one_off') {
  initialKind.value = kind
  modalOpen.value = true
}

function requestRevoke(item: BookingLinkRecord) {
  revokeTarget.value = item
  revokeOpen.value = true
}

async function revoke() {
  if (!revokeTarget.value) return
  revoking.value = true
  try {
    await bookingLinksApi.revoke(revokeTarget.value.id)
    revokeOpen.value = false
    revokeTarget.value = null
    await refresh()
    feedback.success({ title: 'Private link revoked' })
  } catch (failure) {
    feedback.error({ title: 'Could not revoke link', description: apiErrorMessage(failure, 'Try again shortly.') })
  } finally {
    revoking.value = false
  }
}

function rowActions(item: BookingLinkRecord) {
  if (item.status !== 'available') return []
  return [[{
    label: 'Revoke link',
    icon: 'i-lucide-ban',
    color: 'error' as const,
    onSelect: () => requestRevoke(item)
  }]]
}

function kindLabel(item: BookingLinkRecord) {
  return item.kind === 'one_off' ? 'One-off meeting' : 'Single-use link'
}

function statusColor(item: BookingLinkRecord) {
  if (item.status === 'available') return 'success'
  if (item.status === 'booked') return 'primary'
  return 'neutral'
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}
</script>

<template>
  <div class="space-y-7">
    <PageHeader
      title="Meeting links"
      description="Send private invitations that close after one booking. Offer your normal availability or only the times you choose."
    >
      <template #actions>
        <div class="flex items-center gap-2">
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-calendar-plus-2"
            size="md"
            class="meeting-link-header-action"
            @click="openCreate('one_off')"
          >
            One-off meeting
          </UButton>
          <UButton
            icon="i-lucide-link-2"
            size="md"
            class="meeting-link-header-action"
            @click="openCreate('single_use')"
          >
            Single-use link
          </UButton>
        </div>
      </template>
    </PageHeader>

    <section class="overflow-hidden rounded-xl border border-default bg-default">
      <div class="surface-secondary flex items-center border-b border-default px-4 py-4 sm:px-5">
        <ListFilter
          v-model="filter"
          :options="filters"
          :disabled="initialLoading || refreshing"
        />
      </div>

      <ListLoadingSkeleton
        v-if="initialLoading"
        :rows="4"
        label="Loading meeting links"
      />
      <AsyncErrorState
        v-else-if="error && !data"
        title="Could not load meeting links"
        description="Your links are safe. Check your connection and try again."
        :retrying="status === 'pending'"
        @retry="refresh"
      />

      <template v-else>
        <div
          v-if="refreshing"
          class="surface-secondary flex items-center gap-2 border-b border-default px-4 py-2 text-[11px] text-muted sm:px-5"
          role="status"
        >
          <UIcon
            name="i-lucide-loader-circle"
            class="size-3.5 animate-spin text-primary"
          />
          Updating meeting links…
        </div>

        <ul
          v-if="data?.items.length"
          class="divide-y divide-default"
        >
          <li
            v-for="item in data.items"
            :key="item.id"
            class="flex items-start gap-4 px-4 py-5 sm:px-5"
          >
            <span class="flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary">
              <UIcon
                :name="item.kind === 'one_off' ? 'i-lucide-calendar-1' : 'i-lucide-link-2'"
                class="size-5"
              />
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="text-[15px] font-semibold text-highlighted">
                  {{ item.label || item.eventTitle }}
                </h2>
                <UBadge
                  :color="statusColor(item)"
                  variant="subtle"
                >
                  {{ item.status }}
                </UBadge>
              </div>
              <p class="mt-1 text-[13px] text-muted">
                {{ kindLabel(item) }} · {{ item.eventTitle }}
              </p>
              <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-dimmed">
                <span class="flex items-center gap-1.5"><UIcon
                  name="i-lucide-calendar-clock"
                  class="size-3.5"
                />Created {{ dateLabel(item.createdAt) }}</span>
                <span
                  v-if="item.usedAt"
                  class="flex items-center gap-1.5"
                ><UIcon
                  name="i-lucide-check"
                  class="size-3.5"
                />Booked {{ dateLabel(item.usedAt) }}</span>
                <span
                  v-else
                  class="flex items-center gap-1.5"
                ><UIcon
                  name="i-lucide-timer"
                  class="size-3.5"
                />Expires {{ dateLabel(item.expiresAt) }}</span>
              </div>
            </div>
            <UDropdownMenu
              v-if="rowActions(item).length"
              :items="rowActions(item)"
              :ui="compactActionMenuUi"
            >
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-ellipsis"
                class="size-8 justify-center p-0"
                :aria-label="`Actions for ${item.label || item.eventTitle}`"
              />
            </UDropdownMenu>
          </li>
        </ul>

        <ListEmptyState
          v-else
          icon="i-lucide-link-2"
          :title="data?.counts.all ? 'No links in this view' : 'Send a private invitation'"
          :description="data?.counts.all ? 'Choose another filter to see your meeting links.' : 'Create a link for one guest. It closes automatically after they book.'"
        >
          <template #action>
            <UButton
              v-if="!data?.counts.all"
              icon="i-lucide-link-2"
              @click="openCreate('single_use')"
            >
              Create single-use link
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
      Private tokens cannot be recovered from Schedra's database. Copy a link when you create it; revoke it here if plans change.
    </div>

    <BookingLinkModal
      v-model:open="modalOpen"
      :initial-kind="initialKind"
      @created="refresh"
    />
    <ConfirmDialog
      v-model:open="revokeOpen"
      title="Revoke this private link?"
      description="The guest will no longer be able to open or book it."
      confirm-label="Revoke link"
      confirm-color="error"
      :loading="revoking"
      @confirm="revoke"
    />
  </div>
</template>
