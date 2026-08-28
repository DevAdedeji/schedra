<script setup lang="ts">
import type { TeamSummary } from '~/services/schedra-api'

const props = defineProps<{ collapsedLabel?: string }>()

const route = useRoute()
const { data, refresh } = await useTeams()
const creating = ref(false)
const menuOpen = ref(false)

const teams = computed<TeamSummary[]>(() => data.value?.items ?? [])
const activeSlug = computed(() => (
  route.path.startsWith('/t/') ? String(route.params.slug ?? '') : ''
))
const active = computed(() => teams.value.find(item => item.slug === activeSlug.value) ?? null)

watch(() => route.fullPath, () => {
  menuOpen.value = false
})

function initials(name: string) {
  return name.split(' ').map(part => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}

const items = computed(() => [
  [{ label: 'Team', type: 'label' as const }],
  [{
    label: 'Personal',
    icon: 'i-lucide-user',
    to: '/dashboard',
    active: !activeSlug.value
  }],
  teams.value.length
    ? teams.value.map(team => ({
        label: team.name,
        icon: 'i-lucide-users',
        to: `/t/${team.slug}`,
        active: team.slug === activeSlug.value
      }))
    : [{ label: 'No teams yet', type: 'label' as const }],
  [{
    label: 'Create team',
    icon: 'i-lucide-plus',
    onSelect: () => { creating.value = true }
  }]
])

const menuUi = {
  content: 'w-60',
  label: 'px-2.5 py-2 text-[13px]',
  item: 'items-center gap-2 px-2.5 py-2 text-[13px]',
  itemLeadingIcon: 'size-3.5'
}

async function onCreated(slug: string) {
  creating.value = false
  await refresh()
  await navigateTo(`/t/${slug}`)
}
</script>

<template>
  <div>
    <UDropdownMenu
      v-model:open="menuOpen"
      :items="items"
      :ui="menuUi"
      :external-icon="false"
      :modal="false"
      :content="{ align: 'start', side: 'bottom', sideOffset: 6 }"
    >
      <button
        type="button"
        class="flex w-full items-center gap-2.5 rounded-lg border border-default bg-default px-2.5 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        :aria-label="`Current team: ${active?.name ?? 'Personal'}. Switch team`"
      >
        <span
          class="flex size-6 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold"
          :class="active ? 'bg-primary/15 text-primary' : 'bg-elevated text-toned'"
        >
          <UIcon
            v-if="!active"
            name="i-lucide-user"
            class="size-3.5"
          />
          <template v-else>
            {{ initials(active.name) }}
          </template>
        </span>
        <span class="min-w-0 flex-1 truncate text-[13px] font-medium text-highlighted">
          {{ active?.name ?? props.collapsedLabel ?? 'Personal' }}
        </span>
        <UIcon
          name="i-lucide-chevrons-up-down"
          class="size-3.5 shrink-0 text-dimmed"
        />
      </button>
    </UDropdownMenu>

    <TeamCreateModal
      v-model:open="creating"
      @created="onCreated"
    />
  </div>
</template>
