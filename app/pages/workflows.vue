<script setup lang="ts">
import { eventTypesApi } from '~/services/schedra-api'

definePageMeta({ layout: 'app', middleware: 'auth' })
useSeoMeta({ title: 'Workflows', robots: 'noindex, nofollow' })
</script>

<template>
  <WorkflowManager
    :event-types-endpoint="eventTypesApi.listEndpoint"
    :can-manage="true"
  />
</template>
