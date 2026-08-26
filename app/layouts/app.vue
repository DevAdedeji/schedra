<script setup lang="ts">
const { data } = await useCurrentUser()
const { signOut } = useAuthClient()
const { host } = useSiteUrl()
const colorMode = useColorMode()

const user = computed(() => data.value?.user)
const initials = computed(() => (user.value?.name ?? '')
  .split(' ').map(part => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase())

const leaving = ref(false)
const route = useRoute()

// The team comes from the URL, never a stored "active team", so two
// tabs open on different teams can never act on each other's data.
const teamSlug = computed(() => (
  route.path.startsWith('/t/') ? String(route.params.slug ?? '') : ''
))

const personalLinks = [
  { label: 'Overview', to: '/dashboard', icon: 'i-lucide-layout-dashboard' },
  { label: 'Event types', to: '/event-types', icon: 'i-lucide-link-2' },
  { label: 'Bookings', to: '/bookings', icon: 'i-lucide-calendar-days' },
  { label: 'Availability', to: '/availability', icon: 'i-lucide-clock' },
  { label: 'Integrations', to: '/integrations', icon: 'i-lucide-blocks' }
]

const links = computed(() => (teamSlug.value
  ? [
      { label: 'Event types', to: `/t/${teamSlug.value}/event-types`, icon: 'i-lucide-link-2' },
      { label: 'Bookings', to: `/t/${teamSlug.value}/bookings`, icon: 'i-lucide-calendar-days' },
      { label: 'Members', to: `/t/${teamSlug.value}/members`, icon: 'i-lucide-users' },
      { label: 'History', to: `/t/${teamSlug.value}/history`, icon: 'i-lucide-history' },
      { label: 'Billing', to: `/t/${teamSlug.value}/billing`, icon: 'i-lucide-credit-card' },
      { label: 'Settings', to: `/t/${teamSlug.value}/settings`, icon: 'i-lucide-settings' }
    ]
  : personalLinks))

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
    { label: 'View your page', icon: 'i-lucide-eye', slot: 'view-page', to: `/${user.value?.username}`, target: '_blank' }
  ],
  [{
    label: colorMode.value === 'dark' ? 'Light mode' : 'Dark mode',
    icon: colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon',
    onSelect: () => { colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark' }
  }],
  [{ label: 'Sign out', icon: 'i-lucide-log-out', onSelect: leave }]
])

// On mobile every destination lives in this one menu — nothing hides behind a
// second control.
const { data: teamList, refresh: refreshTeams } = await useTeams()
const creatingTeam = ref(false)

const mobileMenu = computed(() => [
  menu.value[0]!,
  links.value.map(link => ({ ...link, active: route.path === link.to })),
  [
    { label: 'Team', type: 'label' as const },
    { label: 'Personal', icon: 'i-lucide-user', to: '/dashboard', active: !teamSlug.value },
    ...(teamList.value?.items ?? []).map(team => ({
      label: team.name,
      icon: 'i-lucide-users',
      to: `/t/${team.slug}`,
      active: team.slug === teamSlug.value
    })),
    {
      label: 'Create team',
      icon: 'i-lucide-plus',
      onSelect: () => { creatingTeam.value = true }
    }
  ],
  ...menu.value.slice(1)
])

async function onTeamCreated(slug: string) {
  creatingTeam.value = false
  await refreshTeams()
  await navigateTo(`/t/${slug}`)
}

const menuUi = {
  content: 'w-56',
  label: 'px-2.5 py-2 text-[13px]',
  item: 'items-center gap-2 px-2.5 py-2 text-[13px]',
  itemLeadingIcon: 'size-3.5',
  itemTrailingIcon: 'size-3.5',
  itemDescription: 'text-[11px]'
}

const mobileMenuUi = {
  ...menuUi,
  content: 'w-72 max-w-[calc(100vw-2rem)]'
}
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

      <div class="px-3 pb-4">
        <TeamSwitcher />
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
          :ui="menuUi"
          :external-icon="false"
          :content="{ side: 'top', align: 'start' }"
        >
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted"
            :disabled="leaving"
          >
            <span class="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/15 text-[11px] font-semibold text-primary">
              <img
                v-if="user?.avatarUrl"
                :src="user.avatarUrl"
                alt=""
                class="size-full object-cover"
              >
              <template v-else>
                {{ initials }}
              </template>
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
          <template #view-page-trailing>
            <UIcon
              name="i-lucide-external-link"
              class="size-3.5 text-dimmed"
            />
          </template>
        </UDropdownMenu>
      </div>
    </aside>

    <header class="sticky top-0 z-40 border-b border-default bg-default/95 backdrop-blur lg:hidden">
      <div class="flex h-16 items-center justify-between px-4 sm:px-5">
        <NuxtLink
          to="/dashboard"
          aria-label="Schedra"
        >
          <SchedraMark />
        </NuxtLink>
        <UDropdownMenu
          :items="mobileMenu"
          :ui="mobileMenuUi"
          :external-icon="false"
          :content="{ align: 'end', side: 'bottom', sideOffset: 8 }"
        >
          <button
            type="button"
            class="flex h-11 items-center rounded-xl border border-default bg-muted/60 p-1 shadow-sm transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            aria-label="Open navigation and account menu"
            :disabled="leaving"
          >
            <span class="flex size-8 items-center justify-center overflow-hidden rounded-lg bg-primary/15 text-[11px] font-semibold text-primary">
              <img
                v-if="user?.avatarUrl"
                :src="user.avatarUrl"
                alt=""
                class="size-full object-cover"
              >
              <template v-else>
                {{ initials }}
              </template>
            </span>
            <span class="mx-1.5 h-5 w-px bg-border" />
            <UIcon
              name="i-lucide-menu"
              class="mr-1 size-4.5 text-muted"
            />
          </button>
          <template #view-page-trailing>
            <UIcon
              name="i-lucide-external-link"
              class="size-3.5 text-dimmed"
            />
          </template>
        </UDropdownMenu>
      </div>
    </header>

    <main class="px-5 py-8 sm:px-8 sm:py-10">
      <div class="mx-auto max-w-5xl">
        <slot />
      </div>
    </main>

    <TeamCreateModal
      v-model:open="creatingTeam"
      @created="onTeamCreated"
    />
  </div>
</template>
