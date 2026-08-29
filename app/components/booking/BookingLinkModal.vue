<script setup lang="ts">
const props = defineProps<{ open: boolean, initialKind?: 'single_use' | 'one_off' }>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  'created': []
}>()

const open = computed({ get: () => props.open, set: value => emit('update:open', value) })
const {
  copied, eventTypes: options, optionsStatus, optionsError, refreshOptions, kind, eventTypeId,
  label, expiryDays, selectedStarts, availability, loadingSlots, slotError, submitting,
  submitError, createdUrl, eventOptions, selectedEvent, groupedSlots,
  dayLabel, timeLabel, toggleSlot, chooseKind, canSubmit, loadSlots, create, copyCreated
} = await useBookingLinkForm({
  open: () => props.open,
  initialKind: () => props.initialKind,
  onCreated: () => emit('created')
})
</script>

<template>
  <UModal
    v-model:open="open"
    :dismissible="!submitting"
    :title="createdUrl ? 'Your private link is ready' : 'Create a private meeting link'"
    :description="createdUrl ? 'Copy it now. For security, Schedra never stores a recoverable copy of the private token.' : 'Share a controlled invitation without changing your regular booking page.'"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div
        v-if="createdUrl"
        class="space-y-5"
      >
        <div class="flex size-12 items-center justify-center rounded-xl bg-success/10 text-success">
          <UIcon
            name="i-lucide-check"
            class="size-5"
          />
        </div>
        <div class="rounded-xl border border-default bg-muted p-4">
          <p class="break-all font-mono text-[14px] leading-relaxed text-highlighted">
            {{ createdUrl }}
          </p>
        </div>
        <div class="flex items-start gap-2 rounded-xl border border-default px-4 py-3 text-[13px] leading-relaxed text-muted">
          <UIcon
            name="i-lucide-shield-check"
            class="mt-0.5 size-4 shrink-0 text-primary"
          />
          The link closes after its first booking. You can also revoke it from Meeting links before it is used.
        </div>
      </div>

      <div
        v-else
        class="space-y-5"
      >
        <div class="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1.5">
          <button
            v-for="option in [
              { value: 'single_use', label: 'Single-use link', description: 'Your normal availability' },
              { value: 'one_off', label: 'One-off meeting', description: 'Only times you choose' }
            ]"
            :key="option.value"
            type="button"
            class="rounded-lg px-3 py-3 text-left transition-colors"
            :class="kind === option.value ? 'bg-default shadow-sm' : 'hover:bg-default/60'"
            @click="chooseKind(option.value)"
          >
            <span class="block text-[14px] font-semibold text-highlighted">{{ option.label }}</span>
            <span class="mt-0.5 block text-[12px] text-muted">{{ option.description }}</span>
          </button>
        </div>

        <USkeleton
          v-if="optionsStatus === 'pending' && !options"
          class="h-16 w-full"
        />
        <AsyncErrorState
          v-else-if="optionsError && !options"
          compact
          title="Could not load your event types"
          description="Check your connection and try again."
          :retrying="optionsStatus === 'pending'"
          @retry="refreshOptions"
        />
        <div
          v-else-if="!eventOptions.length"
          class="rounded-xl border border-default px-4 py-4"
        >
          <p class="text-[14px] font-semibold text-highlighted">
            Create an event type first
          </p>
          <p class="mt-1 text-[13px] leading-relaxed text-muted">
            Meeting links reuse an event type's duration, location and booking rules.
          </p>
          <UButton
            to="/event-types"
            color="neutral"
            variant="outline"
            class="mt-3"
            @click="open = false"
          >
            Go to event types
          </UButton>
        </div>
        <UFormField
          v-else
          label="Meeting type"
          required
        >
          <USelectMenu
            v-model="eventTypeId"
            :items="eventOptions"
            value-key="value"
            label-key="label"
            placeholder="Choose an event type"
            class="w-full"
          />
          <template #help>
            Duration, location, reminders and guest questions come from this event type.
          </template>
        </UFormField>

        <div
          v-if="selectedEvent?.locationReady === false"
          class="flex items-start justify-between gap-3 rounded-xl border border-warning/25 bg-warning/10 px-4 py-3"
        >
          <div class="flex min-w-0 items-start gap-2 text-[13px] leading-relaxed text-warning">
            <UIcon
              name="i-lucide-triangle-alert"
              class="mt-0.5 size-4 shrink-0"
            />
            <span>Choose this event type's meeting provider as the calendar for new bookings before creating its private link.</span>
          </div>
          <UButton
            to="/integrations"
            color="warning"
            variant="outline"
            size="xs"
            @click="open = false"
          >
            Manage
          </UButton>
        </div>

        <UFormField
          label="Private label"
          help="Optional. Only you can see this label."
        >
          <UInput
            v-model="label"
            maxlength="80"
            placeholder="e.g. Interview with Jordan"
            class="w-full"
          />
        </UFormField>

        <UFormField
          v-if="kind === 'single_use'"
          label="Link expires after"
          required
        >
          <USelectMenu
            v-model="expiryDays"
            :items="[
              { label: '24 hours', value: '1' },
              { label: '7 days', value: '7' },
              { label: '30 days', value: '30' },
              { label: '90 days', value: '90' }
            ]"
            value-key="value"
            label-key="label"
            class="w-full"
          />
        </UFormField>

        <div
          v-else
          class="rounded-xl border border-default"
        >
          <div class="border-b border-default px-4 py-3.5">
            <div class="flex items-center justify-between gap-3">
              <div>
                <h3 class="text-[14px] font-semibold text-highlighted">
                  Times your guest can choose
                </h3>
                <p class="mt-0.5 text-[12px] text-muted">
                  Shown in {{ availability?.timeZone ?? 'your schedule timezone' }}.
                </p>
              </div>
              <UBadge
                color="neutral"
                variant="subtle"
              >
                {{ selectedStarts.length }} selected
              </UBadge>
            </div>
          </div>
          <div
            v-if="loadingSlots"
            class="space-y-3 p-4"
            aria-label="Loading available times"
          >
            <USkeleton
              v-for="item in 4"
              :key="item"
              class="h-10 w-full"
            />
          </div>
          <AsyncErrorState
            v-else-if="slotError"
            compact
            title="Could not load available times"
            :description="slotError"
            @retry="loadSlots"
          />
          <div
            v-else-if="groupedSlots.length"
            class="max-h-72 space-y-4 overflow-y-auto p-4"
          >
            <div
              v-for="[date, slots] in groupedSlots"
              :key="date"
              class="grid gap-2 sm:grid-cols-[7rem_1fr]"
            >
              <p class="pt-2 text-[13px] font-medium text-muted">
                {{ dayLabel(date) }}
              </p>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="slot in slots"
                  :key="slot.start"
                  type="button"
                  class="min-h-9 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors"
                  :class="selectedStarts.includes(slot.start) ? 'border-primary bg-primary text-inverted' : 'border-default text-toned hover:border-primary'"
                  :aria-pressed="selectedStarts.includes(slot.start)"
                  @click="toggleSlot(slot.start)"
                >
                  {{ timeLabel(slot.start) }}
                </button>
              </div>
            </div>
          </div>
          <p
            v-else
            class="px-4 py-10 text-center text-[14px] text-muted"
          >
            No available times in the next 30 days.
          </p>
        </div>

        <p
          v-if="submitError"
          class="rounded-lg border border-error/30 bg-error/10 px-3.5 py-3 text-[14px] text-error"
          role="alert"
        >
          {{ submitError }}
        </p>
      </div>
    </template>

    <template #footer>
      <ModalFooter>
        <template #cancel>
          <UButton
            color="neutral"
            variant="soft"
            :disabled="submitting"
            @click="open = false"
          >
            Close
          </UButton>
        </template>
        <template #actions>
          <UButton
            v-if="createdUrl"
            :color="copied ? 'success' : 'primary'"
            :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
            @click="copyCreated"
          >
            {{ copied ? 'Copied' : 'Copy private link' }}
          </UButton>
          <UButton
            v-else
            :loading="submitting"
            :disabled="!canSubmit"
            @click="create"
          >
            Create link
          </UButton>
        </template>
      </ModalFooter>
    </template>
  </UModal>
</template>
