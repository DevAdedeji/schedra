<script setup lang="ts">
definePageMeta({ layout: 'bare' })

const route = useRoute()
const username = String(route.params.username)

const { data: profile, error } = await useFetch(`/api/profile/${username}`)
const { host } = useSiteUrl()

const initials = computed(() => (profile.value?.name ?? '')
  .split(' ')
  .map(part => part[0])
  .filter(Boolean)
  .slice(0, 2)
  .join('')
  .toUpperCase())

useSeoMeta({
  title: () => profile.value ? `Book time with ${profile.value.name}` : 'Not found',
  description: () => profile.value?.bio ?? `Pick a time that works with ${profile.value?.name}.`,
  robots: 'noindex, nofollow'
})
</script>

<template>
  <div class="flex min-h-screen flex-col bg-muted">
    <main class="flex-1 px-5">
      <div class="mx-auto max-w-2xl">
        <div class="pt-6 pb-12">
          <NuxtLink to="/">
            <SchedraMark />
          </NuxtLink>
        </div>

        <div
          v-if="error"
          class="rounded-2xl border border-default bg-default px-8 py-20 text-center"
        >
          <h1 class="font-editorial text-4xl text-highlighted">
            Nothing here.
          </h1>
          <p class="mt-4 text-base text-muted">
            No one is using this link yet.
          </p>
          <UButton
            to="/"
            size="lg"
            class="mt-8 rounded-full px-6 font-medium"
          >
            What is Schedra?
          </UButton>
        </div>

        <div
          v-else
          class="overflow-hidden rounded-2xl border border-default bg-default"
        >
          <div class="flex items-start gap-5 px-7 py-7 sm:px-8">
            <div
              class="flex shrink-0 items-center justify-center rounded-full bg-primary text-xl font-semibold text-white"
              style="width: 64px; height: 64px"
            >
              {{ initials }}
            </div>

            <div class="min-w-0 flex-1 pt-1">
              <h1 class="font-editorial text-3xl leading-none text-highlighted">
                {{ profile?.name }}
              </h1>
              <p class="mt-1.5 truncate text-sm text-dimmed">
                {{ host }}/{{ profile?.username }}
              </p>
              <p
                v-if="profile?.bio"
                class="mt-3 text-[15px] leading-relaxed text-muted"
              >
                {{ profile.bio }}
              </p>
            </div>
          </div>

          <div class="border-t border-default px-7 py-6 sm:px-8">
            <div class="space-y-2.5">
              <NuxtLink
                v-for="type in profile?.eventTypes"
                :key="type.slug"
                :to="`/${username}/${type.slug}`"
                class="flex items-center justify-between gap-5 rounded-xl border border-default px-5 py-4 transition-colors hover:border-primary hover:bg-muted"
              >
                <span class="min-w-0">
                  <span class="block truncate text-[15px] font-semibold text-highlighted">
                    {{ type.title }}
                  </span>
                  <span class="mt-0.5 block truncate text-[13px] text-muted">
                    {{ type.durationMinutes }} minutes
                    <template v-if="type.description">· {{ type.description }}</template>
                  </span>
                </span>

                <span class="shrink-0 rounded-full bg-primary px-4 py-1.5 text-[13px] font-medium text-white">
                  Book
                </span>
              </NuxtLink>

              <p
                v-if="!profile?.eventTypes.length"
                class="rounded-xl border border-dashed border-default px-5 py-12 text-center text-sm text-muted"
              >
                Nothing is open for booking yet.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>

    <footer class="px-5 pb-10 pt-6 text-center text-xs text-dimmed">
      Scheduling by
      <NuxtLink
        to="/"
        class="underline underline-offset-4 transition-colors hover:text-muted"
      >Schedra</NuxtLink>
    </footer>
  </div>
</template>
