<script setup lang="ts">
const features = [
  ['A page of your own', 'Share one memorable link. Guests see what they are booking, how long it takes and when you are free.'],
  ['Timezones sorted', 'Schedra detects each guest’s timezone and lets them change it. Every slot is recalculated for that view.'],
  ['Hours you control', 'Choose the working days, exact hours and timezone that should power your booking page.'],
  ['Race-safe booking', 'Availability is checked again at confirmation and Postgres prevents two people taking the same slot.'],
  ['Changes stay simple', 'Guests can return to one private link to cancel or move a future booking.'],
  ['Durable email delivery', 'Confirmations and cancellations retry safely if the email provider is temporarily unavailable.']
]
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
          <p class="mt-6 max-w-[38ch] text-[16px] leading-relaxed text-muted">
            The launch foundation is deliberately focused: personal scheduling,
            done reliably and without hidden workflow.
          </p>
        </div>

        <dl class="divide-y divide-default border-y border-default">
          <div
            v-for="[title, body] in features"
            :key="title"
            class="grid gap-2 py-7 sm:grid-cols-[13rem_1fr] sm:gap-8"
          >
            <dt class="text-[16px] font-semibold tracking-tight text-highlighted">
              {{ title }}
            </dt>
            <dd class="text-[15px] leading-relaxed text-muted">
              {{ body }}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  </section>
</template>
