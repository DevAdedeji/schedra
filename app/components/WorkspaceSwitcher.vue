<script setup lang="ts">
import type { WorkspaceSummary } from '~/services/schedra-api'

const props = defineProps<{ collapsedLabel?: string }>()

const route = useRoute()
const { data, refresh } = await useWorkspaces()
const creating = ref(false)

const workspaces = computed<WorkspaceSummary[]>(() => data.value?.items ?? [])
const activeSlug = computed(() => (
  route.path.startsWith('/w/') ? String(route.params.slug ?? '') : ''
))
const active = computed(() => workspaces.value.find(item => item.slug === activeSlug.value) ?? null)

function initials(name: string) {
  return name.split(' ').map(part => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}

const items = computed(() => [
  [{ label: 'Workspace', type: 'label' as const }],
  [{
    label: 'Personal',
    icon: 'i-lucide-user',
    to: '/dashboard',
    active: !activeSlug.value
  }],
  workspaces.value.length
    ? workspaces.value.map(workspace => ({
        label: workspace.name,
        icon: 'i-lucide-users',
        to: `/w/${workspace.slug}`,
        active: workspace.slug === activeSlug.value
      }))
    : [{ label: 'No workspaces yet', type: 'label' as const }],
  [{
    label: 'Create workspace',
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
  await navigateTo(`/w/${slug}`)
}
</script>

<template>
  <div>
    <UDropdownMenu
      :items="items"
      :ui="menuUi"
      :external-icon="false"
      :content="{ align: 'start', side: 'bottom', sideOffset: 6 }"
    >
      <button
        type="button"
        class="flex w-full items-center gap-2.5 rounded-lg border border-default bg-default px-2.5 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        :aria-label="`Current workspace: ${active?.name ?? 'Personal'}. Switch workspace`"
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

    <WorkspaceCreateModal
      v-model:open="creating"
      @created="onCreated"
    />
  </div>
</template>
