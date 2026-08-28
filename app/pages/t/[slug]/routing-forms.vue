<script setup lang="ts">
import { teamsApi, type TeamDetail } from '~/services/schedra-api'

definePageMeta({ layout: 'app', middleware: 'auth' })
const route = useRoute()
const slug = computed(() => String(route.params.slug ?? ''))
const { data: team } = await useLazyFetch<TeamDetail>(() => teamsApi.detailEndpoint(slug.value))
const canManage = computed(() => ['owner', 'admin'].includes(team.value?.role ?? 'member'))
useSeoMeta({ title: () => team.value ? `${team.value.organization.name} routing forms` : 'Team routing forms', robots: 'noindex, nofollow' })
</script>

<template>
  <RoutingFormsManager
    :team-slug="slug"
    :can-manage="canManage"
  />
</template>
