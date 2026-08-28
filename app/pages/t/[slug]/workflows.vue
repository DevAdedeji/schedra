<script setup lang="ts">
import { teamEventTypesApi, teamsApi, type TeamDetail } from '~/services/schedra-api'

definePageMeta({ layout: 'app', middleware: 'auth' })
const route = useRoute()
const slug = computed(() => String(route.params.slug ?? ''))
const { data: team } = await useLazyFetch<TeamDetail>(() => teamsApi.detailEndpoint(slug.value))
const canManage = computed(() => ['owner', 'admin'].includes(team.value?.role ?? 'member'))
useSeoMeta({
  title: () => team.value ? `${team.value.organization.name} workflows` : 'Team workflows',
  robots: 'noindex, nofollow'
})
</script>

<template>
  <WorkflowManager
    :team-slug="slug"
    :event-types-endpoint="teamEventTypesApi.listEndpoint(slug)"
    :can-manage="canManage"
  />
</template>
