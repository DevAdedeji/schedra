<script setup lang="ts">
import { apiErrorMessage, schedulesApi, type SchedulesResponse } from '~/services/schedra-api'
import type { ScheduleRecord } from '~/types/schedule'
import { compactActionMenuUi } from '~/utils/action-menu'

definePageMeta({ layout: 'app', middleware: 'auth' })
useSeoMeta({ title: 'Availability schedules', robots: 'noindex, nofollow' })

const query = ref('')
const search = ref('')
const filter = ref<'all' | 'default'>('all')
const page = ref(1)
const apiQuery = computed(() => ({ filter: filter.value, search: search.value, page: page.value, pageSize: 10 }))
const { data, refresh, status, error: loadFailure } = await useLazyFetch<SchedulesResponse>(schedulesApi.listEndpoint, { query: apiQuery })
const feedback = useFeedback()
const zones = Intl.supportedValuesOf('timeZone')
const editorOpen = ref(false)
const selected = ref<ScheduleRecord | null>(null)
const createOpen = ref(false)
const creating = ref(false)
const createError = ref('')
const pageError = ref('')
const draft = reactive({ name: '', timeZone: 'UTC' })
const deleteOpen = ref(false)
const deletingItem = ref<ScheduleRecord | null>(null)
const deleting = ref(false)
const deleteError = ref('')

const filterOptions = computed(() => [
  { value: 'all', label: 'All', count: data.value?.counts.all ?? 0 },
  { value: 'default', label: 'Default', count: data.value?.counts.default ?? 0 }
])
const filtered = computed(() => [...(data.value?.items ?? [])]
  .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)))
const initialLoading = computed(() => status.value === 'pending' && !data.value)
const refreshing = computed(() => status.value === 'pending' && Boolean(data.value))
const blockingFailure = computed(() => Boolean(loadFailure.value && !data.value))

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

onMounted(() => {
  draft.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
})

function openCreate() {
  draft.name = ''
  createError.value = ''
  createOpen.value = true
}

function edit(schedule: ScheduleRecord) {
  selected.value = schedule
  editorOpen.value = true
}

async function createSchedule() {
  if (!draft.name.trim()) {
    createError.value = 'Give this schedule a name.'
    return
  }
  creating.value = true
  createError.value = ''
  try {
    const created = await schedulesApi.create(draft)
    query.value = ''
    search.value = ''
    filter.value = 'all'
    page.value = 1
    await refresh()
    createOpen.value = false
    feedback.success({ title: 'Schedule created', description: 'Add or adjust its working hours now.' })
    const schedule = data.value?.items.find(item => item.id === created.id)
    if (schedule) edit(schedule)
  } catch (failure) {
    createError.value = apiErrorMessage(failure, 'Could not create this schedule just now.')
  } finally {
    creating.value = false
  }
}

async function duplicate(schedule: ScheduleRecord) {
  pageError.value = ''
  try {
    const created = await schedulesApi.duplicate(schedule.id)
    query.value = ''
    search.value = ''
    filter.value = 'all'
    page.value = 1
    await refresh()
    const copy = data.value?.items.find(item => item.id === created.id)
    feedback.success({ title: 'Schedule duplicated', description: `${schedule.name} was copied.` })
    if (copy) edit(copy)
  } catch (failure) {
    pageError.value = apiErrorMessage(failure, 'Could not duplicate this schedule just now.')
  }
}

function requestDelete(schedule: ScheduleRecord) {
  deletingItem.value = schedule
  deleteError.value = ''
  deleteOpen.value = true
}

function scheduleActions(schedule: ScheduleRecord) {
  return [
    [
      {
        label: 'Duplicate',
        icon: 'i-lucide-copy',
        onSelect: async () => { await duplicate(schedule) }
      }
    ],
    [
      {
        label: 'Edit',
        icon: 'i-lucide-square-pen',
        onSelect: () => edit(schedule)
      }
    ],
    [
      {
        label: 'Delete',
        icon: 'i-lucide-trash-2',
        color: 'error' as const,
        onSelect: () => requestDelete(schedule)
      }
    ]
  ]
}

async function confirmDelete() {
  if (!deletingItem.value) return
  const name = deletingItem.value.name
  deleting.value = true
  deleteError.value = ''
  try {
    await schedulesApi.remove(deletingItem.value.id)
    await refresh()
    deleteOpen.value = false
    deletingItem.value = null
    feedback.success({ title: 'Schedule deleted', description: `${name} was removed.` })
  } catch (failure) {
    deleteError.value = apiErrorMessage(failure, 'Could not delete this schedule just now.')
  } finally {
    deleting.value = false
  }
}

async function saved(id: string) {
  await refresh()
  selected.value = data.value?.items.find(item => item.id === id) ?? null
  feedback.success({ title: 'Availability saved' })
}

function scheduleStats(schedule: ScheduleRecord) {
  const days = new Set(schedule.rules.map(rule => rule.weekday)).size
  const minutes = schedule.rules.reduce((total, rule) => total + timeMinutes(rule.end) - timeMinutes(rule.start), 0)
  const hours = minutes / 60
  return {
    days: `${days} bookable ${days === 1 ? 'day' : 'days'}`,
    hours: `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours/week`
  }
}

function timeMinutes(value: string) {
  const [hour = 0, minute = 0] = value.split(':').map(Number)
  return hour * 60 + minute
}
</script>

<template>
  <div class="space-y-7">
    <PageHeader
      title="Availability"
      description="Create reusable schedules, then choose the right one for each event type."
    >
      <template #actions>
        <UButton
          icon="i-lucide-plus"
          class="font-medium"
          @click="openCreate"
        >
          New schedule
        </UButton>
      </template>
    </PageHeader>

    <p
      v-if="pageError"
      class="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-[14px] text-error"
      role="alert"
    >
      {{ pageError }}
    </p>

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
          placeholder="Search schedules"
          aria-label="Search schedules"
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
        label="Loading availability schedules"
      />

      <AsyncErrorState
        v-else-if="blockingFailure"
        title="Could not load availability"
        description="Your schedules are safe. Check your connection and try loading them again."
        :retrying="status === 'pending'"
        @retry="refresh"
      />

      <template v-else>
        <AsyncErrorState
          v-if="loadFailure"
          compact
          class="border-b border-default bg-error/5"
          title="Could not refresh availability"
          description="The last loaded schedules are still shown below."
          :retrying="refreshing"
          @retry="refresh"
        />

        <div
          v-else-if="refreshing"
          class="surface-secondary flex items-center gap-2 border-b border-default px-4 py-2 text-[12px] text-muted sm:px-5"
          role="status"
          aria-live="polite"
        >
          <UIcon
            name="i-lucide-loader-circle"
            class="size-3.5 animate-spin text-primary"
          />
          Updating availability…
        </div>

        <ul
          v-if="filtered.length"
          class="divide-y divide-default"
        >
          <li
            v-for="schedule in filtered"
            :key="schedule.id"
            class="group relative transition-colors hover:bg-muted/60"
          >
            <button
              type="button"
              class="w-full px-4 py-5 text-left sm:px-5"
              @click="edit(schedule)"
            >
              <div class="flex items-start gap-4 sm:gap-5">
                <span class="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary">
                  <UIcon
                    name="i-lucide-calendar-range"
                    class="size-5"
                  />
                </span>
                <div class="min-w-0 flex-1 pr-16 sm:pr-28">
                  <div class="flex flex-wrap items-center gap-2">
                    <h2 class="text-[16px] font-semibold text-highlighted sm:text-[17px]">
                      {{ schedule.name }}
                    </h2>
                    <span
                      v-if="schedule.isDefault"
                      class="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[12px] font-medium text-success"
                    >
                      <span class="size-1.5 rounded-full bg-success" />Default
                    </span>
                  </div>
                  <p class="mt-1.5 text-[14px] text-muted">
                    {{ schedule.timeZone.replace(/_/g, ' ') }}
                  </p>
                  <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-toned">
                    <span class="flex items-center gap-1.5"><UIcon
                      name="i-lucide-calendar-days"
                      class="size-3.5 text-dimmed"
                    />{{ scheduleStats(schedule).days }}</span>
                    <span class="flex items-center gap-1.5"><UIcon
                      name="i-lucide-clock-3"
                      class="size-3.5 text-dimmed"
                    />{{ scheduleStats(schedule).hours }}</span>
                    <span class="flex items-center gap-1.5"><UIcon
                      name="i-lucide-link-2"
                      class="size-3.5 text-dimmed"
                    />{{ schedule.eventTypeCount }} {{ schedule.eventTypeCount === 1 ? 'event type' : 'event types' }}</span>
                    <span
                      v-if="schedule.overrides.length"
                      class="flex items-center gap-1.5"
                    ><UIcon
                      name="i-lucide-calendar-cog"
                      class="size-3.5 text-dimmed"
                    />{{ schedule.overrides.length }} {{ schedule.overrides.length === 1 ? 'override' : 'overrides' }}</span>
                  </div>
                </div>
              </div>
            </button>

            <UDropdownMenu
              :items="scheduleActions(schedule)"
              :ui="compactActionMenuUi"
            >
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-ellipsis"
                class="absolute right-3 top-4 size-7 justify-center p-0 sm:right-5 sm:top-5"
                :ui="{ leadingIcon: 'size-3.5' }"
                :aria-label="`Actions for ${schedule.name}`"
                @click.stop
              />
            </UDropdownMenu>
          </li>
        </ul>

        <ListEmptyState
          v-else-if="data?.counts.all"
          icon="i-lucide-search-x"
          title="No matching schedules"
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
          icon="i-lucide-calendar-plus"
          title="Create your availability"
          description="Add a reusable weekly schedule and connect it to your event types."
        >
          <template #action>
            <UButton
              icon="i-lucide-plus"
              @click="openCreate"
            >
              New schedule
            </UButton>
          </template>
        </ListEmptyState>

        <ListPagination
          v-if="data"
          :page="data.pagination.page"
          :total-pages="data.pagination.totalPages"
          :total="data.pagination.total"
          :page-size="data.pagination.pageSize"
          :disabled="refreshing"
          @change="page = $event"
        />
      </template>
    </section>

    <ScheduleEditorModal
      v-model:open="editorOpen"
      :schedule="selected"
      @saved="saved"
    />

    <UModal
      v-model:open="createOpen"
      title="New schedule"
      description="Start with standard weekday hours, then tailor them to your routine."
    >
      <template #body>
        <form
          id="create-schedule-form"
          class="space-y-5"
          @submit.prevent="createSchedule"
        >
          <UFormField
            label="Schedule name"
            required
          >
            <UInput
              v-model="draft.name"
              maxlength="60"
              placeholder="Office hours"
              autocomplete="off"
              autofocus
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Timezone"
            help="All hours in this schedule use this timezone."
          >
            <USelectMenu
              v-model="draft.timeZone"
              :items="zones"
              :search-input="{ placeholder: 'Search timezones…' }"
              icon="i-lucide-globe"
              class="w-full"
            />
          </UFormField>
          <p
            v-if="createError"
            class="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-[14px] text-error"
            role="alert"
          >
            {{ createError }}
          </p>
        </form>
      </template>
      <template #footer>
        <ModalFooter>
          <template #cancel>
            <UButton
              color="neutral"
              variant="soft"
              :disabled="creating"
              @click="createOpen = false"
            >
              Cancel
            </UButton>
          </template>
          <template #actions>
            <UButton
              type="submit"
              form="create-schedule-form"
              :loading="creating"
              :disabled="!draft.name.trim()"
            >
              Create and edit
            </UButton>
          </template>
        </ModalFooter>
      </template>
    </UModal>

    <UModal
      v-model:open="deleteOpen"
      title="Delete schedule"
      :description="`Delete ${deletingItem?.name ?? 'this schedule'}? This cannot be undone.`"
    >
      <template #body>
        <p class="text-[14px] leading-relaxed text-muted">
          Default schedules and schedules assigned to event types cannot be deleted. Choose a new default or reassign those event types first.
        </p>
        <p
          v-if="deleteError"
          class="mt-4 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-[14px] text-error"
          role="alert"
        >
          {{ deleteError }}
        </p>
      </template>
      <template #footer>
        <ModalFooter>
          <template #cancel>
            <UButton
              color="neutral"
              variant="soft"
              :disabled="deleting"
              @click="deleteOpen = false"
            >
              Cancel
            </UButton>
          </template>
          <template #actions>
            <UButton
              color="error"
              :loading="deleting"
              @click="confirmDelete"
            >
              Delete schedule
            </UButton>
          </template>
        </ModalFooter>
      </template>
    </UModal>
  </div>
</template>
