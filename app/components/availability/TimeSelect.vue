<script setup lang="ts">
const model = defineModel<string>({ required: true })

const items = Array.from({ length: 96 }, (_, index) => {
  const minutes = index * 15
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  const value = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  const label = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' })
    .format(new Date(`2000-01-01T${value}:00Z`))
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
