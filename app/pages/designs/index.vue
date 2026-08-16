<script setup lang="ts">
definePageMeta({ layout: 'bare' })
useHead({ title: 'Design samples — Schedra' })

const designs = [
  {
    to: '/designs/editorial',
    name: 'Editorial',
    line: 'Warm, magazine-like, serif headlines',
    body: 'Asymmetric layout with a high-contrast serif display face, generous whitespace and soft shadows. Premium and human — closer to a good magazine than a SaaS page. Best if you want Schedra to feel considered and calm rather than loud.',
    notes: ['Instrument Serif display', 'Asymmetric hero', 'Warm paper background', 'Ruled feature list']
  },
  {
    to: '/designs/bold',
    name: 'Bold',
    line: 'Vermillion-forward, oversized type, chunky',
    body: 'A full vermillion hero panel, huge tight headlines and rounded cards. High energy and impossible to mistake for anyone else. Best if you want to be memorable and confident, and you are happy to lean hard on the accent colour.',
    notes: ['Vermillion hero panel', 'Rounded 2rem shapes', 'Scrolling claim strip', 'Dark closing panel']
  },
  {
    to: '/designs/calm',
    name: 'Calm',
    line: 'Centred, airy, product-led',
    body: 'A centred hero with the booking widget as the hero image, then simple three-column sections. The most conventional of the three, which is also why it is the safest — visitors know exactly how to read it.',
    notes: ['Centred hero', 'Product as hero image', 'Soft card grid', 'Sticky header']
  }
]
</script>

<template>
  <div class="min-h-screen bg-muted">
    <DesignSwitcher />

    <div class="mx-auto max-w-[64rem] px-6 pb-24 pt-28">
      <SchedraMark />

      <h1 class="mt-10 text-[clamp(2.25rem,5vw,3.5rem)] font-semibold leading-[1.02] tracking-[-0.04em] text-highlighted">
        Three directions.
      </h1>
      <p class="mt-5 max-w-[52ch] text-[16px] leading-relaxed text-muted">
        All three keep the vermillion, the warm greys and the logo. They differ
        in layout, typography and how loud they are. Each is a real page — click
        through and scroll. Pick one and it becomes the homepage.
      </p>

      <div class="mt-14 grid gap-5">
        <NuxtLink
          v-for="design in designs"
          :key="design.to"
          :to="design.to"
          class="group grid gap-6 rounded-2xl border border-default bg-default p-8 transition-shadow hover:shadow-lg sm:grid-cols-[12rem_1fr]"
        >
          <div>
            <h2 class="text-[22px] font-semibold tracking-tight text-highlighted">
              {{ design.name }}
            </h2>
            <p class="mt-1.5 text-[13px] leading-snug text-primary">
              {{ design.line }}
            </p>
          </div>

          <div>
            <p class="text-[15px] leading-relaxed text-muted">
              {{ design.body }}
            </p>
            <ul class="mt-5 flex flex-wrap gap-2">
              <li
                v-for="note in design.notes"
                :key="note"
                class="rounded-full border border-default px-3 py-1 text-[12px] text-toned"
              >
                {{ note }}
              </li>
            </ul>
            <span class="mt-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-highlighted">
              View
              <UIcon
                name="i-lucide-arrow-right"
                class="size-3.5 transition-transform group-hover:translate-x-0.5"
              />
            </span>
          </div>
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
