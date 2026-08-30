<script setup lang="ts">
import {
  apiErrorMessage,
  awayPeriodsApi,
  type AwayPeriodRecord,
  type AwayPeriodsResponse
} from '~/services/schedra-api'
import { formatCalendarDate, todayCalendarDate } from '~/utils/date-time'

const { data, status, error: loadFailure, refresh } = await useLazyFetch<AwayPeriodsResponse>(awayPeriodsApi.endpoint)
const feedback = useFeedback()
const editorOpen = ref(false)
const editing = ref<AwayPeriodRecord | null>(null)
const saving = ref(false)
const saveError = ref('')
const deleteOpen = ref(false)
const deleting = ref(false)
const deletingItem = ref<AwayPeriodRecord | null>(null)
const deleteError = ref('')
const draft = reactive({ name: '', startDate: '', endDate: '' })

const initialLoading = computed(() => status.value === 'pending' && !data.value)
const refreshing = computed(() => status.value === 'pending' && Boolean(data.value))
const items = computed(() => data.value?.items ?? [])
const today = computed(() => todayCalendarDate(data.value?.timeZone))
const invalid = computed(() => !draft.name.trim() || !draft.startDate || !draft.endDate || draft.endDate < draft.startDate)

function openCreate() {
  const current = today.value
  editing.value = null
  Object.assign(draft, { name: '', startDate: current, endDate: current })
  saveError.value = ''
  editorOpen.value = true
}

function openEdit(period: AwayPeriodRecord) {
  editing.value = period
  Object.assign(draft, {
    name: period.name,
    startDate: period.startDate,
    endDate: period.endDate
  })
  saveError.value = ''
  editorOpen.value = true
}

async function save() {
  if (invalid.value) {
    saveError.value = draft.endDate < draft.startDate
      ? 'The end date must be on or after the start date.'
      : 'Add a name and choose both dates.'
    return
  }

  saving.value = true
  saveError.value = ''
  try {
    const body = { name: draft.name, startDate: draft.startDate, endDate: draft.endDate }
    const result = editing.value
      ? await awayPeriodsApi.update(editing.value.id, body)
      : await awayPeriodsApi.create(body)
    await refresh()
    editorOpen.value = false
    if (result.conflictingBookingCount) {
      feedback.warning({
        title: 'Time off saved with existing bookings',
        description: `${result.conflictingBookingCount} existing ${result.conflictingBookingCount === 1 ? 'booking stays' : 'bookings stay'} scheduled. New times inside this range are blocked.`
      })
    } else {
      feedback.success({ title: editing.value ? 'Time off updated' : 'Time off added' })
    }
  } catch (failure) {
    saveError.value = apiErrorMessage(failure, 'Could not save this time off just now.')
  } finally {
    saving.value = false
  }
}

function requestDelete(period: AwayPeriodRecord) {
  deletingItem.value = period
  deleteError.value = ''
  deleteOpen.value = true
}

async function confirmDelete() {
  if (!deletingItem.value) return
  deleting.value = true
  deleteError.value = ''
  try {
    await awayPeriodsApi.remove(deletingItem.value.id)
    await refresh()
    feedback.success({ title: 'Time off removed', description: 'Those dates can offer times again.' })
    deleteOpen.value = false
    deletingItem.value = null
  } catch (failure) {
    deleteError.value = apiErrorMessage(failure, 'Could not remove this time off just now.')
  } finally {
    deleting.value = false
  }
}

function dateLabel(period: AwayPeriodRecord) {
  const start = formatCalendarDate(period.startDate, { month: 'short', day: 'numeric', year: 'numeric' })
  if (period.startDate === period.endDate) return start
  const end = formatCalendarDate(period.endDate, { month: 'short', day: 'numeric', year: 'numeric' })
  return `${start} – ${end}`
}
</script>

<template>
  <section class="overflow-hidden rounded-xl border border-default bg-default">
    <div class="surface-secondary flex flex-col gap-3 border-b border-default px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div>
        <h2 class="text-[16px] font-semibold text-highlighted">
          Time off
        </h2>
        <p class="mt-1 text-[13px] leading-relaxed text-muted">
          Block a date range across every personal and team event you host.
        </p>
      </div>
      <UButton
        color="neutral"
        variant="outline"
        size="sm"
        icon="i-lucide-plus"
        class="self-start sm:self-auto"
        :disabled="initialLoading"
        @click="openCreate"
      >
        Add time off
      </UButton>
    </div>

    <ListLoadingSkeleton
      v-if="initialLoading"
      :rows="2"
      label="Loading time off"
    />

    <AsyncErrorState
      v-else-if="loadFailure && !data"
      title="Could not load time off"
      description="Your saved dates are safe. Check your connection and try again."
      :retrying="status === 'pending'"
      @retry="refresh"
    />

    <template v-else>
      <AsyncErrorState
        v-if="loadFailure"
        compact
        class="border-b border-default bg-error/5"
        title="Could not refresh time off"
        description="The last loaded dates are still shown below."
        :retrying="refreshing"
        @retry="refresh"
      />

      <ul
        v-if="items.length"
        class="divide-y divide-default"
      >
        <li
          v-for="period in items"
          :key="period.id"
          class="flex items-start gap-3 px-4 py-4 sm:items-center sm:px-5"
        >
          <span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <UIcon
              name="i-lucide-plane"
              class="size-4.5"
            />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <p class="text-[14px] font-semibold text-highlighted">
                {{ period.name }}
              </p>
              <span
                v-if="period.endDate < today"
                class="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted"
              >Past</span>
              <span
                v-if="period.conflictingBookingCount"
                class="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning"
              >
                <UIcon
                  name="i-lucide-triangle-alert"
                  class="size-3"
                />
                {{ period.conflictingBookingCount }} existing {{ period.conflictingBookingCount === 1 ? 'booking' : 'bookings' }}
              </span>
            </div>
            <p class="mt-1 text-[13px] text-muted">
              {{ dateLabel(period) }}
            </p>
            <p class="mt-1 text-[11px] text-dimmed">
              All day in {{ period.timeZone.replace(/_/g, ' ') }}. Existing bookings are not cancelled.
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-square-pen"
              class="size-8 justify-center p-0"
              :ui="{ leadingIcon: 'size-4' }"
              :aria-label="`Edit ${period.name}`"
              @click="openEdit(period)"
            />
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-trash-2"
              class="size-8 justify-center p-0 hover:text-error"
              :ui="{ leadingIcon: 'size-4' }"
              :aria-label="`Remove ${period.name}`"
              @click="requestDelete(period)"
            />
          </div>
        </li>
      </ul>

      <ListEmptyState
        v-else
        icon="i-lucide-calendar-off"
        title="No time off scheduled"
        description="Add a vacation or away period without changing each availability schedule."
      >
        <template #action>
          <UButton
            icon="i-lucide-plus"
            @click="openCreate"
          >
            Add time off
          </UButton>
        </template>
      </ListEmptyState>
    </template>

    <UModal
      v-model:open="editorOpen"
      :title="editing ? 'Edit time off' : 'Add time off'"
      description="These dates are blocked across every event you host. Existing bookings stay scheduled."
    >
      <template #body>
        <form
          id="away-period-form"
          class="space-y-5"
          @submit.prevent="save"
        >
          <UFormField
            label="Name"
            required
          >
            <UInput
              v-model="draft.name"
              maxlength="80"
              placeholder="Summer holiday"
              autocomplete="off"
              class="w-full"
            />
          </UFormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField
              label="Starts"
              required
            >
              <UInput
                v-model="draft.startDate"
                type="date"
                class="w-full"
                @update:model-value="draft.endDate = draft.endDate < draft.startDate ? draft.startDate : draft.endDate"
              />
            </UFormField>
            <UFormField
              label="Ends"
              required
            >
              <UInput
                v-model="draft.endDate"
                type="date"
                :min="draft.startDate"
                class="w-full"
              />
            </UFormField>
          </div>
          <p class="rounded-lg bg-muted px-4 py-3 text-[13px] leading-relaxed text-muted">
            Time off begins at midnight on the first date and ends after the final date in your account timezone.
          </p>
          <p
            v-if="saveError"
            class="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-[14px] text-error"
            role="alert"
          >
            {{ saveError }}
          </p>
        </form>
      </template>
      <template #footer>
        <ModalFooter>
          <template #cancel>
            <UButton
              color="neutral"
              variant="soft"
              :disabled="saving"
              @click="editorOpen = false"
            >
              Cancel
            </UButton>
          </template>
          <template #actions>
            <UButton
              type="submit"
              form="away-period-form"
              :loading="saving"
              :disabled="invalid"
            >
              {{ editing ? 'Save changes' : 'Add time off' }}
            </UButton>
          </template>
        </ModalFooter>
      </template>
    </UModal>

    <UModal
      v-model:open="deleteOpen"
      title="Remove time off"
      :description="`Remove ${deletingItem?.name ?? 'this time off'}? Those dates may become bookable again.`"
    >
      <template #body>
        <p class="text-[14px] leading-relaxed text-muted">
          Your weekly schedules and existing bookings will not be changed.
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
              Remove time off
            </UButton>
          </template>
        </ModalFooter>
      </template>
    </UModal>
  </section>
</template>
