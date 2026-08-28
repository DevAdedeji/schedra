<script setup lang="ts">
definePageMeta({ layout: 'bare' })

const route = useRoute()
const token = String(route.params.token)
const { data, error } = await useFetch<{ username: string, slug: string }>(`/api/meeting-links/guest/${encodeURIComponent(token)}`)
</script>

<template>
  <BookingFlow
    v-if="data && !error"
    mode="invite"
    :owner="data.username"
    :slug="data.slug"
    :invite-token="token"
  />
  <div
    v-else
    class="flex min-h-screen items-center justify-center bg-muted px-5"
  >
    <div class="w-full max-w-xl rounded-2xl border border-default bg-default px-8 py-16 text-center">
      <h1 class="font-editorial text-4xl text-highlighted">
        This invitation is closed.
      </h1>
      <p class="mt-4 text-base text-muted">
        It may have already been booked, expired or been withdrawn by the host.
      </p>
    </div>
  </div>
</template>
