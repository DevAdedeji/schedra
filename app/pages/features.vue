<script setup lang="ts">
import { productFeatureGroups } from '~/data/product-features'

definePageMeta({ layout: 'default' })

const origin = useRuntimeConfig().public.siteUrl || useRequestURL().origin
const canonical = `${origin.replace(/\/$/, '')}/features`
const { isSignedIn, accountDestination } = await useLandingNavigation()

useSeoMeta({
  title: 'Scheduling, automation, analytics and payments',
  description: 'Explore Schedra features for booking pages, routing, workflows, team scheduling, analytics, paid bookings and website overlays.',
  ogTitle: 'Everything you need to turn availability into a confirmed meeting',
  ogDescription: 'Scheduling, routing, automation, integrations, analytics, paid bookings and team workspaces in one clear flow.',
  ogUrl: canonical
})
useHead({ link: [{ rel: 'canonical', href: canonical }] })
</script>

<template>
  <div class="bg-muted">
    <section class="border-b border-default">
      <div class="mx-auto max-w-312 px-6 py-20 text-center lg:px-10 lg:py-28">
        <p class="eyebrow text-primary">
          Schedra features
        </p>
        <h1 class="mx-auto mt-6 max-w-4xl font-editorial text-[clamp(3rem,7vw,5.75rem)] leading-[0.98] tracking-[-0.025em] text-highlighted">
          More powerful scheduling.<br><em class="text-primary">Less work to use it.</em>
        </h1>
        <p class="mx-auto mt-7 max-w-2xl text-[17px] leading-relaxed text-toned">
          Start with a booking link. Add routing, automation, teams, analytics or payment only when you need them—without rebuilding the guest experience.
        </p>
        <div class="mt-9 flex flex-wrap justify-center gap-3">
          <UButton
            :to="accountDestination"
            size="xl"
            class="rounded-full px-7 font-medium"
          >
            {{ isSignedIn ? 'Go to dashboard' : 'Create your link' }}
          </UButton>
          <UButton
            to="/pricing"
            size="xl"
            color="neutral"
            variant="outline"
            class="rounded-full px-7 font-medium"
          >
            Compare plans
          </UButton>
        </div>
      </div>
    </section>

    <section
      v-for="(group, groupIndex) in productFeatureGroups"
      :key="group.eyebrow"
      class="border-b border-default"
    >
      <div class="mx-auto grid max-w-312 gap-12 px-6 py-20 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20 lg:px-10 lg:py-24">
        <div>
          <p
            class="eyebrow"
            :class="groupIndex === 1 ? 'text-success' : 'text-primary'"
          >
            {{ group.eyebrow }}
          </p>
          <h2 class="mt-5 max-w-xl font-editorial text-[clamp(2.25rem,4vw,3.5rem)] leading-[1.04] tracking-[-0.02em] text-highlighted">
            {{ group.title }}
          </h2>
          <p class="mt-5 max-w-[42ch] text-[15px] leading-relaxed text-muted">
            {{ group.description }}
          </p>
        </div>
        <div class="grid gap-px overflow-hidden rounded-2xl border border-default bg-default sm:grid-cols-2">
          <article
            v-for="feature in group.features"
            :key="feature.title"
            class="surface-secondary min-h-52 p-6 sm:p-7"
          >
            <span class="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <UIcon
                :name="feature.icon"
                class="size-4"
              />
            </span>
            <h3 class="mt-8 text-[17px] font-semibold tracking-tight text-highlighted">
              {{ feature.title }}
            </h3>
            <p class="mt-3 text-[14px] leading-relaxed text-muted">
              {{ feature.summary }}
            </p>
          </article>
        </div>
      </div>
    </section>

    <section>
      <div class="mx-auto max-w-312 px-6 py-20 text-center lg:px-10 lg:py-24">
        <h2 class="font-editorial text-[clamp(2.5rem,5vw,4rem)] leading-none text-highlighted">
          Your next meeting can be easier.
        </h2>
        <p class="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-muted">
          Create a free personal booking page, then bring in the advanced tools when they earn their place.
        </p>
        <UButton
          :to="accountDestination"
          size="xl"
          class="mt-8 rounded-full px-7 font-medium"
        >
          {{ isSignedIn ? 'Open Schedra' : 'Start free' }}
        </UButton>
      </div>
    </section>
  </div>
</template>
