<script setup lang="ts">
definePageMeta({ layout: 'bare' })
useHead({ title: 'Calm — Schedra design sample' })

const steps = [
  { icon: 'i-lucide-clock', title: 'Say when you\'re free', body: 'Set your usual hours once. Block a holiday whenever you like.' },
  { icon: 'i-lucide-link', title: 'Share your link', body: 'A page of your own — signature, bio, or straight to one person.' },
  { icon: 'i-lucide-calendar-check', title: 'You\'re booked', body: 'It lands in both calendars, and you both get a reminder.' }
]

const features = [
  { icon: 'i-lucide-calendar-sync', title: 'Works with your calendar', body: 'Google, Outlook and Apple. If you are busy there, that time is not offered.' },
  { icon: 'i-lucide-globe', title: 'Timezones sorted', body: 'Someone in Tokyo sees Tokyo time. Nobody does the maths or joins an hour late.' },
  { icon: 'i-lucide-layers', title: 'Every kind of meeting', body: 'A quick chat, a long review, a group session. Each with its own link and rules.' },
  { icon: 'i-lucide-sliders-horizontal', title: 'Your hours, your rules', body: 'Finish early on Fridays, keep a gap between calls, cap how many you take.' },
  { icon: 'i-lucide-bell', title: 'Nobody forgets', body: 'A confirmation when booked, a reminder before it starts, an email if things change.' },
  { icon: 'i-lucide-users', title: 'Book the whole team', body: 'One link for everyone, take enquiries in turns, or get several people in a room.' }
]
</script>

<template>
  <div class="min-h-screen bg-default">
    <DesignSwitcher />

    <header class="sticky top-0 z-40 border-b border-default bg-default/85 backdrop-blur-md">
      <div class="mx-auto flex h-16 max-w-[72rem] items-center justify-between px-6">
        <SchedraMark />
        <div class="flex items-center gap-6">
          <a class="hidden text-[13px] text-muted transition-colors hover:text-highlighted sm:block">How it works</a>
          <a class="hidden text-[13px] text-muted transition-colors hover:text-highlighted sm:block">Features</a>
          <UButton
            size="sm"
            class="font-medium"
          >
            Sign up free
          </UButton>
        </div>
      </div>
    </header>

    <section class="mx-auto max-w-[72rem] px-6 pb-16 pt-20 text-center lg:pb-24 lg:pt-28">
      <span class="inline-flex items-center gap-2 rounded-full border border-default bg-muted px-3.5 py-1.5 text-[12px] font-medium text-toned">
        <span class="size-1.5 rounded-full bg-primary" />
        Free, and open source
      </span>

      <h1 class="mx-auto mt-8 max-w-[15ch] text-[clamp(2.75rem,7vw,5rem)] font-semibold leading-[0.98] tracking-[-0.04em] text-highlighted">
        Share a link. Get booked.
      </h1>

      <p class="mx-auto mt-7 max-w-[52ch] text-[17px] leading-[1.6] text-muted">
        Schedra shows people when you're free so they can pick a time that suits
        you both. It lands in your calendar and reminds everyone — with none of
        the back-and-forth emails.
      </p>

      <div class="mt-10 flex flex-wrap items-center justify-center gap-3">
        <UButton
          size="xl"
          class="px-7 font-medium"
        >
          Create your link
        </UButton>
        <UButton
          size="xl"
          color="neutral"
          variant="outline"
          class="px-6 font-medium"
        >
          See how it works
        </UButton>
      </div>

      <p class="mt-5 text-[13px] text-dimmed">
        No credit card. Takes about two minutes.
      </p>

      <div class="relative mx-auto mt-16 max-w-[26rem]">
        <div class="absolute -inset-x-24 -inset-y-8 -z-10 rounded-full bg-primary/10 blur-3xl" />
        <ClientOnly>
          <BookingDemo />
          <template #fallback>
            <div class="h-[26rem] rounded-lg border border-default bg-muted" />
          </template>
        </ClientOnly>
        <p class="mt-4 text-[12px] text-dimmed">
          This is what people see. Try it.
        </p>
      </div>
    </section>

    <section class="border-t border-default bg-muted">
      <div class="mx-auto max-w-[72rem] px-6 py-20 lg:py-28">
        <div class="mx-auto max-w-[36rem] text-center">
          <p class="eyebrow text-primary">
            How it works
          </p>
          <h2 class="mt-5 text-[clamp(2rem,4.5vw,3.25rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-highlighted">
            Three steps, then forget about it.
          </h2>
        </div>

        <ol class="mt-16 grid gap-8 md:grid-cols-3 md:gap-10">
          <li
            v-for="(step, index) in steps"
            :key="step.title"
            class="text-center"
          >
            <span class="mx-auto flex size-12 items-center justify-center rounded-2xl border border-default bg-default shadow-sm">
              <UIcon
                :name="step.icon"
                class="size-5 text-primary"
              />
            </span>
            <h3 class="mt-6 text-[18px] font-semibold tracking-tight text-highlighted">
              <span class="tnum text-primary">{{ index + 1 }}.</span>
              {{ step.title }}
            </h3>
            <p class="mx-auto mt-2.5 max-w-[32ch] text-[15px] leading-relaxed text-muted">
              {{ step.body }}
            </p>
          </li>
        </ol>
      </div>
    </section>

    <section class="mx-auto max-w-[72rem] px-6 py-20 lg:py-28">
      <div class="mx-auto max-w-[36rem] text-center">
        <p class="eyebrow text-primary">
          What you get
        </p>
        <h2 class="mt-5 text-[clamp(2rem,4.5vw,3.25rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-highlighted">
          Everything you need. Nothing you don't.
        </h2>
        <p class="mt-5 text-[16px] leading-relaxed text-muted">
          Nothing locked behind a paid tier. If it exists, you can use it.
        </p>
      </div>

      <div class="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="feature in features"
          :key="feature.title"
          class="rounded-xl border border-default bg-default p-7 transition-shadow hover:shadow-md"
        >
          <UIcon
            :name="feature.icon"
            class="size-5 text-primary"
          />
          <h3 class="mt-6 text-[16px] font-semibold tracking-tight text-highlighted">
            {{ feature.title }}
          </h3>
          <p class="mt-2 text-[14px] leading-relaxed text-muted">
            {{ feature.body }}
          </p>
        </div>
      </div>
    </section>

    <section class="border-t border-default bg-muted">
      <div class="mx-auto max-w-[72rem] px-6 py-24 text-center lg:py-32">
        <h2 class="mx-auto max-w-[16ch] text-[clamp(2.25rem,5.5vw,4rem)] font-semibold leading-[1] tracking-[-0.04em] text-highlighted">
          Get your booking link.
        </h2>
        <p class="mx-auto mt-6 max-w-[40ch] text-[16px] leading-relaxed text-muted">
          Free, takes about two minutes, and your calendar comes along.
        </p>
        <UButton
          size="xl"
          class="mt-9 px-8 font-medium"
        >
          Create your link
        </UButton>
      </div>
    </section>

    <footer class="border-t border-default">
      <div class="mx-auto flex max-w-[72rem] flex-col gap-3 px-6 py-10 text-[13px] text-dimmed sm:flex-row sm:items-center sm:justify-between">
        <SchedraMark />
        <span>No ads. No tracking. No charge per person.</span>
      </div>
    </footer>
  </div>
</template>
