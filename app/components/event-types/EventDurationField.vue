<script setup lang="ts">
const durationMinutes = defineModel<number>({ required: true })
const additionalDurationMinutes = defineModel<number[]>('additional', { required: true })

const adding = ref(false)
const nextDuration = ref<number | undefined>()
const addError = ref('')

watch(durationMinutes, (value) => {
  additionalDurationMinutes.value = additionalDurationMinutes.value.filter(duration => duration !== value)
})

function addDuration() {
  const value = Number(nextDuration.value)
  if (!Number.isInteger(value) || value < 5 || value > 720) {
    addError.value = 'Use a whole number between 5 and 720.'
    return
  }
  if (value === durationMinutes.value || additionalDurationMinutes.value.includes(value)) {
    addError.value = 'That duration is already offered.'
    return
  }
  if (additionalDurationMinutes.value.length >= 4) {
    addError.value = 'You can offer up to five durations.'
    return
  }
  additionalDurationMinutes.value = [...additionalDurationMinutes.value, value].sort((a, b) => a - b)
  nextDuration.value = undefined
  addError.value = ''
  adding.value = false
}

function removeDuration(value: number) {
  additionalDurationMinutes.value = additionalDurationMinutes.value.filter(duration => duration !== value)
}
</script>

<template>
  <div class="space-y-3">
    <UFormField
      :label="additionalDurationMinutes.length ? 'Default duration' : 'Duration'"
      name="durationMinutes"
      required
    >
      <UInput
        v-model.number="durationMinutes"
        type="number"
        min="5"
        max="720"
        step="5"
        size="lg"
        class="w-full"
      >
        <template #trailing>
          <span class="text-xs text-dimmed">minutes</span>
        </template>
      </UInput>
    </UFormField>

    <div
      v-if="additionalDurationMinutes.length"
      class="flex flex-wrap gap-2"
      aria-label="Other offered durations"
    >
      <span
        v-for="duration in additionalDurationMinutes"
        :key="duration"
        class="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-default bg-muted py-1 pr-1 pl-3 text-[13px] font-medium text-toned"
      >
        {{ duration }} min
        <button
          type="button"
          class="flex size-8 items-center justify-center rounded-full text-muted hover:bg-default hover:text-highlighted"
          :aria-label="`Remove ${duration} minute duration`"
          @click="removeDuration(duration)"
        >
          <UIcon
            name="i-lucide-x"
            class="size-3.5"
          />
        </button>
      </span>
    </div>

    <div
      v-if="adding"
      class="flex flex-col gap-2 sm:flex-row sm:items-start"
    >
      <UInput
        v-model.number="nextDuration"
        type="number"
        min="5"
        max="720"
        step="5"
        placeholder="e.g. 60"
        aria-label="Another duration in minutes"
        class="w-full sm:max-w-44"
        @keydown.enter.prevent="addDuration"
      />
      <div class="flex gap-2">
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          @click="addDuration"
        >
          Add
        </UButton>
        <UButton
          type="button"
          color="neutral"
          variant="ghost"
          @click="adding = false; addError = ''"
        >
          Cancel
        </UButton>
      </div>
    </div>
    <UButton
      v-else-if="additionalDurationMinutes.length < 4"
      type="button"
      color="neutral"
      variant="link"
      icon="i-lucide-plus"
      class="min-h-10 px-0"
      @click="adding = true"
    >
      Offer another duration
    </UButton>
    <p
      v-if="addError"
      class="text-[12px] text-error"
      role="alert"
    >
      {{ addError }}
    </p>
    <p
      v-if="additionalDurationMinutes.length"
      class="text-[12px] leading-relaxed text-muted"
    >
      Guests choose a duration before they choose a time.
    </p>
  </div>
</template>
