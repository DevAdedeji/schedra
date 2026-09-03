<script setup lang="ts">
const solutions = [
  {
    title: 'For consultants',
    description: 'Offer flexible meeting lengths, paid sessions and automatic client follow-ups.',
    to: '/solutions/consultants',
    icon: 'i-lucide-briefcase-business'
  },
  {
    title: 'For small businesses',
    description: 'Accept appointments online and coordinate services across a growing team.',
    to: '/solutions/small-business',
    icon: 'i-lucide-store'
  },
  {
    title: 'For paid appointments',
    description: 'Keep reservations, checkout confirmation and payment history connected.',
    to: '/solutions/paid-appointments',
    icon: 'i-lucide-wallet-cards'
  },
  {
    title: 'For scheduling teams',
    description: 'Use round robin, collective availability and managed team event types.',
    to: '/solutions/team-scheduling',
    icon: 'i-lucide-users-round'
  }
]
</script>

<template>
  <section
    id="solutions"
    class="border-y border-default bg-default"
  >
    <div class="mx-auto max-w-312 px-6 py-20 lg:px-10 lg:py-28">
      <div class="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
        <div>
          <p class="eyebrow text-primary">
            Scheduling for real work
          </p>
          <h2 class="mt-5 max-w-[18ch] font-editorial text-[clamp(2.5rem,5vw,4rem)] leading-[1.02] tracking-[-0.02em] text-highlighted">
            One clear booking flow, shaped around how you work.
          </h2>
        </div>
        <NuxtLink
          to="/compare/calendly-alternative"
          class="group inline-flex items-center gap-2 text-[15px] font-semibold text-toned transition-colors hover:text-primary"
        >
          Looking for a Calendly alternative?
          <UIcon
            name="i-lucide-arrow-right"
            class="size-4 transition-transform group-hover:translate-x-0.5"
          />
        </NuxtLink>
      </div>

      <div class="mt-12 grid gap-px overflow-hidden rounded-2xl border border-default bg-default sm:grid-cols-2 lg:grid-cols-4">
        <NuxtLink
          v-for="solution in solutions"
          :key="solution.to"
          :to="solution.to"
          class="group surface-secondary min-h-64 p-7 transition-colors hover:bg-primary/5"
        >
          <span class="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <UIcon
              :name="solution.icon"
              class="size-5"
            />
          </span>
          <h3 class="mt-10 flex items-center justify-between gap-3 text-[17px] font-semibold text-highlighted">
            {{ solution.title }}
            <UIcon
              name="i-lucide-arrow-up-right"
              class="size-4 text-dimmed transition group-hover:text-primary"
            />
          </h3>
          <p class="mt-3 text-[15px] leading-relaxed text-muted">
            {{ solution.description }}
          </p>
        </NuxtLink>
      </div>
    </div>
  </section>
</template>
