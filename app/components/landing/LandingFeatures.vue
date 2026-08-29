<script setup lang="ts">
import { landingFeatureHighlights as features } from '~/data/product-features'
</script>

<template>
  <section
    id="features"
    class="bg-muted"
  >
    <div class="mx-auto max-w-312 px-6 py-20 lg:px-10 lg:py-28">
      <div class="grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
        <div class="lg:sticky lg:top-32 lg:self-start">
          <p class="eyebrow text-dimmed">
            What you get
          </p>
          <h2 class="mt-6 font-editorial text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.05] tracking-[-0.02em] text-highlighted">
            Everything you need. Nothing you don't.
          </h2>
          <p class="mt-6 max-w-[38ch] text-[17px] leading-relaxed text-muted">
            Start with scheduling, then add routing, automation, analytics or
            payments when the experience calls for them.
          </p>
          <UButton
            to="/features"
            color="neutral"
            variant="outline"
            trailing-icon="i-lucide-arrow-right"
            class="mt-7 rounded-full font-medium"
          >
            Explore every feature
          </UButton>
        </div>

        <dl class="divide-y divide-default border-y border-default">
          <div
            v-for="[title, body] in features"
            :key="title"
            class="grid gap-2 py-7 sm:grid-cols-[13rem_1fr] sm:gap-8"
          >
            <dt class="text-[17px] font-semibold tracking-tight text-highlighted">
              {{ title }}
            </dt>
            <dd class="text-[16px] leading-relaxed text-muted">
              {{ body }}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  </section>
</template>
