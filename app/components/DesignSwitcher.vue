<script setup lang="ts">
const route = useRoute()

const designs = [
  { label: 'Editorial', to: '/designs/editorial' },
  { label: 'Bold', to: '/designs/bold' },
  { label: 'Calm', to: '/designs/calm' }
]
</script>

<template>
  <div class="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
    <nav class="flex items-center gap-1 rounded-full border border-default bg-default/90 p-1 shadow-lg ring-1 ring-black/5 backdrop-blur">
      <NuxtLink
        to="/designs"
        class="rounded-full px-3 py-1.5 text-[12px] font-medium text-dimmed transition-colors hover:text-highlighted"
      >
        All
      </NuxtLink>
      <NuxtLink
        v-for="design in designs"
        :key="design.to"
        :to="design.to"
        class="rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors"
        :class="route.path === design.to
          ? 'bg-primary text-white'
          : 'text-muted hover:text-highlighted'"
      >
        {{ design.label }}
      </NuxtLink>
    </nav>
  </div>
</template>
