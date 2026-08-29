<script setup lang="ts">
import { publicTeamApi, type PublicTeamProfile } from '~/services/schedra-api'

definePageMeta({ layout: 'bare' })

const route = useRoute()
const slug = String(route.params.slug)

const { data: team, error, status } = await useFetch<PublicTeamProfile>(publicTeamApi.profileEndpoint(slug))
const { url: siteUrl, indexable } = useSiteUrl()

if (error.value) setResponseStatus(error.value.statusCode === 404 ? 404 : 503)
const missing = computed(() => error.value?.statusCode === 404)

// A renamed team keeps its old links working, but the canonical URL is the
// current one so search engines do not index both.
const canonical = computed(() => `${siteUrl.value}/team/${encodeURIComponent(team.value?.slug ?? slug)}`)

const initials = computed(() => (team.value?.name ?? '')
  .split(' ').map(part => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase())

const modeLabel: Record<string, string> = {
  single: 'One host',
  round_robin: 'Whoever is free',
  collective: 'The whole team'
}

useSeoMeta({
  title: () => team.value ? `Book time with ${team.value.name}` : 'Not found',
  description: () => `Choose a time to meet with ${team.value?.name ?? 'this team'}.`,
  robots: () => indexable.value && team.value ? 'index, follow' : 'noindex, nofollow',
  ogTitle: () => team.value ? `Book time with ${team.value.name}` : 'Schedra team page',
  ogUrl: canonical
})

useHead({ link: [{ key: 'canonical', rel: 'canonical', href: canonical }] })
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
          v-if="status === 'pending' && !team"
          class="overflow-hidden rounded-2xl border border-default bg-default p-7"
          role="status"
          aria-label="Loading team page"
        >
          <USkeleton class="size-16 rounded-2xl" />
          <USkeleton class="mt-5 h-7 w-48 rounded" />
          <USkeleton class="mt-3 h-4 w-64 rounded" />
        </div>

        <div
          v-else-if="missing"
          class="rounded-2xl border border-default bg-default px-7 py-14 text-center"
        >
          <h1 class="text-[20px] font-semibold text-highlighted">
            No such team page
          </h1>
          <p class="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-muted">
            This link may have changed, or the team may no longer be taking bookings.
          </p>
        </div>

        <div
          v-else-if="error"
          class="rounded-2xl border border-default bg-default px-7 py-14 text-center"
        >
          <h1 class="text-[20px] font-semibold text-highlighted">
            This page is temporarily unavailable
          </h1>
          <p class="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-muted">
            Please try again in a moment.
          </p>
        </div>

        <template v-else-if="team">
          <div class="overflow-hidden rounded-2xl border border-default bg-default">
            <div class="flex items-start gap-5 px-7 py-7 sm:px-8">
              <span class="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary/10 text-[18px] font-semibold text-primary">
                <img
                  v-if="team.logo"
                  :src="team.logo"
                  alt=""
                  class="size-full object-cover"
                >
                <template v-else>
                  {{ initials }}
                </template>
              </span>
              <div class="min-w-0 flex-1 pt-1">
                <h1 class="text-[24px] font-semibold tracking-tight text-highlighted">
                  {{ team.name }}
                </h1>
                <p class="mt-1.5 text-[15px] text-muted">
                  Pick a meeting and choose a time that suits you.
                </p>
              </div>
            </div>
          </div>

          <ul
            v-if="team.eventTypes.length"
            class="mt-4 space-y-3 pb-16"
          >
            <li
              v-for="eventType in team.eventTypes"
              :key="eventType.slug"
            >
              <NuxtLink
                :to="`/team/${team.slug}/${eventType.slug}`"
                class="block rounded-2xl border border-default bg-default px-6 py-5 transition-colors hover:border-primary/40 hover:bg-elevated"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-[17px] font-medium text-highlighted">{{ eventType.title }}</span>
                  <UBadge
                    color="neutral"
                    variant="subtle"
                    size="sm"
                  >
                    {{ eventType.durationMinutes }} min
                  </UBadge>
                  <UBadge
                    color="info"
                    variant="subtle"
                    size="sm"
                  >
                    {{ modeLabel[eventType.assignmentMode] }}
                  </UBadge>
                  <UBadge
                    v-if="eventType.capacity > 1"
                    color="primary"
                    variant="subtle"
                    size="sm"
                  >
                    Up to {{ eventType.capacity }} guests
                  </UBadge>
                </div>
                <p
                  v-if="eventType.description"
                  class="mt-1.5 text-[14px] leading-relaxed text-muted"
                >
                  {{ eventType.description }}
                </p>
              </NuxtLink>
            </li>
          </ul>

          <div
            v-else
            class="mt-4 rounded-2xl border border-default bg-default px-7 py-12 text-center"
          >
            <p class="text-[15px] text-muted">
              This team has not published any booking links yet.
            </p>
          </div>
        </template>
      </div>
    </main>
  </div>
</template>
