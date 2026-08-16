<script setup lang="ts">
definePageMeta({ layout: 'bare' })
useHead({ title: 'Bold — Schedra design sample' })

const marquee = [
  'No back-and-forth',
  'Free forever',
  'Any timezone',
  'Works with your calendar',
  'No ads',
  'No tracking'
]

const steps = [
  { n: '01', title: 'Say when you\'re free', body: 'Set your hours once. Block a holiday whenever you like.' },
  { n: '02', title: 'Share your link', body: 'A page of your own. Signature, bio, or straight to one person.' },
  { n: '03', title: 'You\'re booked', body: 'It lands in both calendars, and you both get a reminder.' }
]

const features = [
  { icon: 'i-lucide-calendar-sync', title: 'Works with your calendar', body: 'Google, Outlook and Apple. Busy there means busy here.' },
  { icon: 'i-lucide-globe', title: 'Timezones sorted', body: 'Someone in Tokyo sees Tokyo time. Nobody does the maths.' },
  { icon: 'i-lucide-layers', title: 'Every kind of meeting', body: 'Quick chats, long reviews, group sessions. Each with its own link.' },
  { icon: 'i-lucide-bell', title: 'Nobody forgets', body: 'Confirmations, reminders, and an email when plans change.' },
  { icon: 'i-lucide-users', title: 'Book the whole team', body: 'One link for everyone, or take enquiries in turns.' },
  { icon: 'i-lucide-repeat', title: 'Change of plan? Fine.', body: 'One tap to move or cancel. Calendars update themselves.' }
]
</script>

<template>
  <div class="min-h-screen bg-default">
    <DesignSwitcher />

    <section class="px-3 pt-20">
      <div class="rounded-[2rem] bg-primary px-6 py-16 text-white sm:px-10 lg:rounded-[2.5rem] lg:px-16 lg:py-20">
        <div class="mx-auto max-w-[76rem]">
          <header class="flex items-center justify-between">
            <SchedraMark
              variant="line"
              inverted
            />
            <UButton
              size="lg"
              color="neutral"
              class="rounded-full bg-white px-5 font-semibold text-stone-900 hover:bg-white/90"
            >
              Sign up free
            </UButton>
          </header>

          <div class="grid items-center gap-14 pt-16 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:pt-24">
            <div>
              <h1 class="text-[clamp(3.5rem,9vw,7.5rem)] font-bold leading-[0.86] tracking-[-0.05em]">
                Share a link.<br>
                Get booked.
              </h1>

              <p class="mt-8 max-w-[40ch] text-[18px] leading-[1.55] text-white/85">
                Stop asking what time works. Schedra shows people when you're
                free, they pick, and it's in your calendar.
              </p>

              <div class="mt-10 flex flex-wrap items-center gap-3">
                <UButton
                  size="xl"
                  color="neutral"
                  class="rounded-full bg-white px-8 text-[15px] font-semibold text-stone-900 hover:bg-white/90"
                >
                  Create your link
                </UButton>
                <UButton
                  size="xl"
                  color="neutral"
                  variant="ghost"
                  class="rounded-full px-6 text-[15px] font-semibold text-white hover:bg-white/15"
                  trailing-icon="i-lucide-arrow-down"
                >
                  How it works
                </UButton>
              </div>
            </div>

            <div class="rounded-2xl bg-default p-2 shadow-2xl">
              <ClientOnly>
                <BookingDemo />
                <template #fallback>
                  <div class="h-[26rem] rounded-lg bg-muted" />
                </template>
              </ClientOnly>
            </div>
          </div>
        </div>
      </div>
    </section>

    <div class="overflow-hidden border-y border-default py-5">
      <div class="marquee flex w-max gap-10 whitespace-nowrap">
        <span
          v-for="(item, i) in [...marquee, ...marquee, ...marquee]"
          :key="i"
          class="flex items-center gap-10 text-[15px] font-semibold tracking-tight text-toned"
        >
          {{ item }}
          <span class="size-1.5 rounded-full bg-primary" />
        </span>
      </div>
    </div>

    <section class="mx-auto max-w-[76rem] px-6 py-20 lg:py-28">
      <h2 class="max-w-[14ch] text-[clamp(2.5rem,6vw,4.5rem)] font-bold leading-[0.94] tracking-[-0.045em] text-highlighted">
        Three steps. That's the whole thing.
      </h2>

      <ol class="mt-16 grid gap-5 md:grid-cols-3">
        <li
          v-for="step in steps"
          :key="step.n"
          class="rounded-3xl border-2 border-default p-8 transition-colors hover:border-primary"
        >
          <span class="tnum text-[15px] font-bold text-primary">{{ step.n }}</span>
          <h3 class="mt-10 text-[22px] font-bold leading-tight tracking-[-0.03em] text-highlighted">
            {{ step.title }}
          </h3>
          <p class="mt-3 text-[15px] leading-relaxed text-muted">
            {{ step.body }}
          </p>
        </li>
      </ol>
    </section>

    <section class="mx-auto max-w-[76rem] px-6 pb-20 lg:pb-28">
      <h2 class="max-w-[14ch] text-[clamp(2.5rem,6vw,4.5rem)] font-bold leading-[0.94] tracking-[-0.045em] text-highlighted">
        Everything you need.
      </h2>

      <div class="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="feature in features"
          :key="feature.title"
          class="rounded-3xl bg-muted p-8"
        >
          <span class="flex size-11 items-center justify-center rounded-2xl bg-primary">
            <UIcon
              :name="feature.icon"
              class="size-5 text-white"
            />
          </span>
          <h3 class="mt-8 text-[18px] font-bold tracking-[-0.02em] text-highlighted">
            {{ feature.title }}
          </h3>
          <p class="mt-2.5 text-[15px] leading-relaxed text-muted">
            {{ feature.body }}
          </p>
        </div>
      </div>
    </section>

    <section class="px-3 pb-3">
      <div class="rounded-[2rem] bg-stone-900 px-6 py-24 text-center lg:rounded-[2.5rem] lg:py-32 dark:bg-stone-800">
        <h2 class="mx-auto max-w-[16ch] text-[clamp(2.75rem,7vw,5.5rem)] font-bold leading-[0.92] tracking-[-0.05em] text-white">
          Get your booking link.
        </h2>
        <p class="mx-auto mt-7 max-w-[38ch] text-[17px] leading-relaxed text-white/70">
          Free, two minutes, and your calendar comes along.
        </p>
        <UButton
          size="xl"
          class="mt-10 rounded-full px-9 text-[15px] font-semibold"
        >
          Create your link
        </UButton>
        <p class="mt-14 text-[13px] text-white/50">
          No ads. No tracking. No charge per person.
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.marquee {
  animation: slide 32s linear infinite;
}

@keyframes slide {
  to {
    transform: translateX(-33.333%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .marquee {
    animation: none;
  }
}
</style>
