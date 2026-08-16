<script setup lang="ts">
const features = [
  ['Works with your calendar', 'Google, Outlook and Apple. If you are already busy there, that time is not offered.'],
  ['Timezones sorted', 'Someone in Tokyo sees Tokyo time. Nobody does the maths, and nobody joins an hour late.'],
  ['Every kind of meeting', 'A quick chat, a long review, a group session. Each one gets its own link and its own rules.'],
  ['Your hours, your rules', 'Finish early on Fridays, block a holiday, keep a gap between calls, cap how many you take.'],
  ['Nobody forgets', 'A confirmation when it is booked, a reminder before it starts, an email if plans change.'],
  ['Book the whole team', 'One link for everyone, take enquiries in turns, or get several people in the same room.']
]
</script>

<template>
  <section
    id="features"
    class="bg-muted"
  >
    <div class="mx-auto max-w-[78rem] px-6 py-20 lg:px-10 lg:py-28">
      <div class="grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
        <div class="lg:sticky lg:top-32 lg:self-start">
          <p class="eyebrow text-dimmed">
            What you get
          </p>
          <h2 class="mt-6 font-editorial text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.05] tracking-[-0.02em] text-highlighted">
            Everything you need. Nothing you don't.
          </h2>
          <p class="mt-6 max-w-[38ch] text-[16px] leading-relaxed text-muted">
            Nothing locked behind a paid tier. If it exists, you can use it.
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
