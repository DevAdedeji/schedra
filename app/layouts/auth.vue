<script setup lang="ts">
const promises = [
  'Free forever, no card needed',
  'One link for every meeting',
  'No ads or resale of personal data'
]
</script>

<template>
  <div class="min-h-screen lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
    <aside class="relative flex flex-col justify-between overflow-hidden bg-primary px-6 py-5 text-white lg:px-14 lg:py-14">
      <div
        class="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-white/10 blur-3xl"
        aria-hidden="true"
      />

      <NuxtLink
        to="/"
        class="relative"
        aria-label="Schedra home"
      >
        <SchedraMark
          variant="line"
          inverted
        />
      </NuxtLink>

      <div class="relative mt-12 hidden lg:mt-0 lg:block">
        <p class="font-editorial text-[clamp(2rem,3.4vw,3.25rem)] leading-[1.08] tracking-[-0.02em]">
          Never ask
          <em class="not-italic opacity-70">“what time<br class="hidden sm:block"> works?”</em>
          again.
        </p>

        <div class="mt-10 hidden max-w-76 rounded-2xl bg-white/12 p-4 backdrop-blur-sm ring-1 ring-white/20 sm:block">
          <div class="flex items-start gap-3">
            <span class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-white">
              <UIcon
                name="i-lucide-check"
                class="size-3.5 text-primary"
              />
            </span>
            <div class="min-w-0">
              <p class="text-[14px] font-semibold leading-tight">
                Tuesday, 10:30
              </p>
              <p class="mt-1 text-[12px] leading-tight text-white/70">
                Booking confirmed · email queued
              </p>
            </div>
          </div>
        </div>
      </div>

      <ul class="relative mt-12 hidden space-y-2.5 lg:mt-0 lg:block">
        <li
          v-for="promise in promises"
          :key="promise"
          class="flex items-center gap-2.5 text-[13px] text-white/85"
        >
          <UIcon
            name="i-lucide-check"
            class="size-3.5 shrink-0"
          />
          {{ promise }}
        </li>
      </ul>
    </aside>

    <main class="flex items-center justify-center bg-default px-6 py-14 lg:px-14">
      <div class="w-full max-w-100">
        <slot />
      </div>
    </main>
  </div>
</template>
