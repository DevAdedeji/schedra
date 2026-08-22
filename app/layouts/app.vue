<script setup lang="ts">
const { data } = await useCurrentUser()
const { signOut } = useAuthClient()
const { host } = useSiteUrl()
const colorMode = useColorMode()

const user = computed(() => data.value?.user)
const initials = computed(() => (user.value?.name ?? '')
  .split(' ').map(part => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase())

const links = [
  { label: 'Overview', to: '/dashboard', icon: 'i-lucide-layout-dashboard' },
  { label: 'Event types', to: '/event-types', icon: 'i-lucide-link-2' },
  { label: 'Bookings', to: '/bookings', icon: 'i-lucide-calendar-days' },
  { label: 'Availability', to: '/availability', icon: 'i-lucide-clock' }
]

const open = ref(false)
const leaving = ref(false)

async function leave() {
  leaving.value = true
  try {
    await signOut()
    clearNuxtData('current-user')
    await navigateTo('/login')
  } finally {
    leaving.value = false
  }
}

const menu = computed(() => [
  [{
    label: user.value?.name ?? '',
    description: `${host.value}/${user.value?.username ?? ''}`,
    type: 'label' as const
  }],
  [
    { label: 'Settings', icon: 'i-lucide-settings', to: '/settings' },
    { label: 'View your page', icon: 'i-lucide-external-link', to: `/${user.value?.username}`, target: '_blank' }
  ],
  [{
    label: colorMode.value === 'dark' ? 'Light mode' : 'Dark mode',
    icon: colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon',
    onSelect: () => { colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark' }
  }],
  [{ label: 'Sign out', icon: 'i-lucide-log-out', onSelect: leave }]
])
</script>

<template>
  <div class="min-h-screen bg-muted lg:grid lg:grid-cols-[15rem_1fr]">
    <aside class="hidden border-r border-default bg-default lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
      <div class="px-5 py-6">
        <NuxtLink
          to="/dashboard"
          aria-label="Schedra"
        >
          <SchedraMark />
        </NuxtLink>
      </div>

      <nav class="flex-1 space-y-2 px-3">
        <NuxtLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium transition-colors"
          :class="$route.path === link.to
            ? 'bg-elevated text-highlighted'
            : 'text-muted hover:bg-muted hover:text-highlighted'"
        >
          <UIcon
            :name="link.icon"
            class="size-4 shrink-0"
            :class="$route.path === link.to && 'text-primary'"
          />
          {{ link.label }}
        </NuxtLink>
      </nav>

      <div class="p-3">
        <UDropdownMenu
          :items="menu"
          :ui="{ content: 'w-56' }"
          :content="{ side: 'top', align: 'start' }"
        >
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted"
            :disabled="leaving"
          >
            <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-semibold text-white">
              {{ initials }}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[13px] font-medium text-highlighted">{{ user?.name }}</span>
              <span class="block truncate text-[11px] text-dimmed">{{ host }}/{{ user?.username }}</span>
            </span>
            <UIcon
              name="i-lucide-chevrons-up-down"
              class="size-4 shrink-0 text-dimmed"
            />
          </button>
        </UDropdownMenu>
      </div>
    </aside>

    <header class="sticky top-0 z-40 border-b border-default bg-default lg:hidden">
      <div class="flex h-14 items-center justify-between px-5">
        <NuxtLink
          to="/dashboard"
          aria-label="Schedra"
        >
          <SchedraMark />
        </NuxtLink>
        <div class="flex items-center gap-2">
          <UDropdownMenu
            :items="menu"
            :ui="{ content: 'w-56' }"
          >
            <button
              type="button"
              class="flex size-11 items-center justify-center rounded-full bg-primary text-[12px] font-semibold text-white"
              aria-label="Account"
            >
              {{ initials }}
            </button>
          </UDropdownMenu>
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            class="size-11 justify-center"
            :icon="open ? 'i-lucide-x' : 'i-lucide-menu'"
            aria-label="Menu"
            @click="open = !open"
          />
        </div>
      </div>

      <nav
        v-if="open"
        class="border-t border-default px-3 py-2"
      >
        <NuxtLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] font-medium"
          :class="$route.path === link.to ? 'bg-elevated text-highlighted' : 'text-muted'"
          @click="open = false"
        >
          <UIcon
            :name="link.icon"
            class="size-4 shrink-0"
          />
          {{ link.label }}
        </NuxtLink>
      </nav>
    </header>

    <main class="px-5 py-8 sm:px-8 sm:py-10">
      <div class="mx-auto max-w-5xl">
        <slot />
      </div>
    </main>
  </div>
</template>
