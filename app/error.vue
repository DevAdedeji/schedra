<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()
const route = useRoute()

const notFound = computed(() => props.error.statusCode === 404)
const title = computed(() => notFound.value ? 'Page not found' : 'Something went wrong')
const description = computed(() => notFound.value
  ? 'The page may have moved, or the link may no longer be available.'
  : 'Your data is safe. Try this page again, or return to Schedra.')

useSeoMeta({
  title,
  robots: 'noindex, nofollow'
})

function retry() {
  clearError({ redirect: route.fullPath })
}
</script>

<template>
  <UApp>
    <main class="grid min-h-screen place-items-center bg-muted px-5 py-16">
      <section class="w-full max-w-lg rounded-2xl border border-default bg-default px-7 py-12 text-center shadow-sm sm:px-12">
        <NuxtLink
          to="/"
          aria-label="Schedra home"
          class="inline-flex"
        >
          <SchedraMark />
        </NuxtLink>

        <span class="mx-auto mt-10 grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
          <UIcon
            :name="notFound ? 'i-lucide-map-pin-off' : 'i-lucide-cloud-alert'"
            class="size-5"
          />
        </span>
        <p class="mt-6 text-[12px] font-semibold uppercase tracking-[0.14em] text-dimmed">
          Error {{ error.statusCode || 500 }}
        </p>
        <h1 class="mt-2 font-editorial text-4xl text-highlighted">
          {{ title }}
        </h1>
        <p class="mx-auto mt-4 max-w-sm text-[15px] leading-relaxed text-muted">
          {{ description }}
        </p>

        <div class="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <UButton
            v-if="!notFound"
            size="lg"
            icon="i-lucide-refresh-cw"
            class="justify-center rounded-full px-6"
            @click="retry"
          >
            Try again
          </UButton>
          <UButton
            to="/"
            size="lg"
            color="neutral"
            variant="outline"
            class="justify-center rounded-full px-6"
          >
            Go to Schedra
          </UButton>
        </div>
      </section>
    </main>
  </UApp>
</template>
