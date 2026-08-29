<script setup lang="ts">
import { formatTime } from '~/utils/date-time'

const model = defineModel<string>({ required: true })

const items = Array.from({ length: 96 }, (_, index) => {
  const minutes = index * 15
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  const value = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  const label = formatTime(`2000-01-01T${value}:00Z`, 'UTC', 'en')
  return { label, value }
})
</script>

<template>
  <USelectMenu
    v-model="model"
    :items="items"
    value-key="value"
    label-key="label"
    :search-input="{ placeholder: 'Search time…' }"
    icon="i-lucide-clock-3"
    class="w-full"
  />
</template>
