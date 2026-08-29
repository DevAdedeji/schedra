<script setup lang="ts">
definePageMeta({ layout: 'app', middleware: 'auth' })
useSeoMeta({ title: 'Create a team', robots: 'noindex, nofollow' })

// A real destination for "Start a team" links, so a marketing CTA never has to
// dump someone on the dashboard and hope they find the switcher.
const open = ref(true)
const { refresh } = await useTeams()

async function onCreated(slug: string) {
  open.value = false
  await refresh()
  await navigateTo(`/t/${slug}`)
}

watch(open, async (value) => {
  if (!value) await navigateTo('/dashboard')
})
</script>

<template>
  <div class="mx-auto max-w-lg py-10 text-center">
    <h1 class="font-editorial text-[2rem] leading-tight tracking-[-0.02em] text-highlighted">
      Create a team
    </h1>
    <p class="mt-3 text-[16px] leading-relaxed text-muted">
      Share one booking link the whole team hosts. Your personal page stays exactly as it is.
    </p>

    <UButton
      v-if="!open"
      class="mt-6"
      @click="open = true"
    >
      Start
    </UButton>

    <TeamCreateModal
      v-model:open="open"
      @created="onCreated"
    />
  </div>
</template>
