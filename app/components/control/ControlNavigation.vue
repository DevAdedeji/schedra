<script setup lang="ts">
const route = useRoute()
const links = [
  { label: 'Overview', to: '/control', icon: 'i-lucide-layout-dashboard' },
  { label: 'Users', to: '/control/users', icon: 'i-lucide-users' },
  { label: 'Event types', to: '/control/event-types', icon: 'i-lucide-link-2' },
  { label: 'Teams', to: '/control/teams', icon: 'i-lucide-building-2' },
  { label: 'Bookings', to: '/control/bookings', icon: 'i-lucide-calendar-days' },
  { label: 'Payments', to: '/control/payments', icon: 'i-lucide-wallet-cards' },
  { label: 'Operations', to: '/control/operations', icon: 'i-lucide-activity' }
]

function active(to: string) {
  return to === '/control' ? route.path === to : route.path.startsWith(to)
}
</script>

<template>
  <nav
    class="mb-7 overflow-x-auto rounded-xl border border-default bg-default p-1.5"
    aria-label="Control navigation"
  >
    <div class="flex min-w-max items-center gap-1">
      <UButton
        v-for="link in links"
        :key="link.to"
        :to="link.to"
        :label="link.label"
        :icon="link.icon"
        color="neutral"
        :variant="active(link.to) ? 'soft' : 'ghost'"
        size="sm"
        :aria-current="active(link.to) ? 'page' : undefined"
      />
    </div>
  </nav>
</template>
