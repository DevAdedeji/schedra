<script setup lang="ts">
const features = [
  ['Book from anywhere', 'Share a memorable link or open the same booking flow over your own website without redirecting visitors.'],
  ['Timezones sorted', 'Schedra detects each guest’s timezone and lets them change it. Every slot is recalculated for that view.'],
  ['Your calendars protected', 'Google and Microsoft calendars block busy times, receive bookings and stay current after a change.'],
  ['A room created for you', 'Create a private Google Meet, Microsoft Teams or Zoom link automatically for each confirmed booking.'],
  ['Schedule alone or together', 'Keep your personal page private, then add round-robin or collective event types in a shared team workspace.'],
  ['Reliable when services wobble', 'Race-safe confirmation, durable email delivery and calendar retries protect every booking workflow.']
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
            Personal and team scheduling, calendar and video integrations, and
            a booking flow that works on your page or inside your website.
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
