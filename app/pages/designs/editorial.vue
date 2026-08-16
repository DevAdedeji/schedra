<script setup lang="ts">
definePageMeta({ layout: 'bare' })
useHead({ title: 'Editorial — Schedra design sample' })

const steps = [
  {
    title: 'Say when you\'re free',
    body: 'Set your usual hours once. Different times on different days is fine, and a holiday is two clicks.'
  },
  {
    title: 'Share your link',
    body: 'A page of your own. Drop it in your signature, your bio, or send it to one person.'
  },
  {
    title: 'You\'re booked',
    body: 'They pick a time. It lands in both calendars, and you both get a reminder.'
  }
]

const features = [
  ['Works with your calendar', 'Google, Outlook and Apple. Busy there means busy here.'],
  ['Timezones sorted', 'Someone in Tokyo sees Tokyo time. Nobody does the maths.'],
  ['Different kinds of meetings', 'A quick chat, a long review, a group session. Each with its own link.'],
  ['Nobody forgets', 'Confirmations, reminders, and an email when plans change.']
]
</script>

<template>
  <div class="min-h-screen bg-muted">
    <DesignSwitcher />

    <header class="mx-auto flex max-w-[78rem] items-center justify-between px-6 pb-4 pt-24 lg:px-10">
      <SchedraMark />
      <div class="flex items-center gap-6">
        <a class="hidden text-[13px] text-muted transition-colors hover:text-highlighted sm:block">How it works</a>
        <a class="hidden text-[13px] text-muted transition-colors hover:text-highlighted sm:block">Pricing</a>
        <UButton
          size="sm"
          class="rounded-full px-4 font-medium"
        >
          Sign up free
        </UButton>
      </div>
    </header>

    <section class="mx-auto max-w-[78rem] px-6 pb-20 pt-10 lg:px-10 lg:pb-28 lg:pt-16">
      <div class="grid items-center gap-14 lg:grid-cols-[1.15fr_0.85fr] lg:gap-20">
        <div>
          <p class="eyebrow text-primary">
            Free · No credit card
          </p>

          <h1 class="mt-7 font-editorial text-[clamp(3.25rem,8vw,6.5rem)] font-normal leading-[0.94] tracking-[-0.02em] text-highlighted">
            Share a link.<br>
            Get <em class="text-primary">booked.</em>
          </h1>

          <p class="mt-8 max-w-[44ch] text-[17px] leading-[1.65] text-toned">
            Schedra shows people when you're free so they can pick a time that
            suits you both — then puts it in your calendar and reminds everyone.
            No more asking what time works.
          </p>

          <div class="mt-10 flex flex-wrap items-center gap-3">
            <UButton
              size="xl"
              class="rounded-full px-7 font-medium"
            >
              Create your link
            </UButton>
            <UButton
              size="xl"
              color="neutral"
              variant="ghost"
              class="rounded-full px-5 font-medium"
              trailing-icon="i-lucide-arrow-right"
            >
              See how it works
            </UButton>
          </div>

          <p class="mt-8 text-[13px] text-dimmed">
            Loved by people who never want to send
            <em class="font-editorial text-[15px] not-italic text-toned">“does Tuesday work?”</em>
            again.
          </p>
        </div>

        <div class="relative">
          <div class="absolute -inset-6 -rotate-2 rounded-[2rem] bg-primary/10" />
          <div class="relative rounded-2xl bg-default p-2 shadow-2xl ring-1 ring-black/5">
            <ClientOnly>
              <BookingDemo />
              <template #fallback>
                <div class="h-[26rem] rounded-lg bg-muted" />
              </template>
            </ClientOnly>
          </div>
        </div>
      </div>
    </section>

    <section class="border-y border-default bg-default">
      <div class="mx-auto max-w-[78rem] px-6 py-20 lg:px-10 lg:py-28">
        <p class="eyebrow text-dimmed">
          How it works
        </p>
        <h2 class="mt-6 max-w-[16ch] font-editorial text-[clamp(2.25rem,5vw,3.75rem)] leading-[1.05] tracking-[-0.02em] text-highlighted">
          Three steps, then forget about it.
        </h2>

        <ol class="mt-16 grid gap-12 md:grid-cols-3 md:gap-10">
          <li
            v-for="(step, index) in steps"
            :key="step.title"
          >
            <span class="font-editorial text-[3rem] leading-none text-primary">
              {{ index + 1 }}
            </span>
            <h3 class="mt-5 text-[19px] font-semibold tracking-tight text-highlighted">
              {{ step.title }}
            </h3>
            <p class="mt-3 max-w-[34ch] text-[15px] leading-relaxed text-muted">
              {{ step.body }}
            </p>
          </li>
        </ol>
      </div>
    </section>

    <section class="mx-auto max-w-[78rem] px-6 py-20 lg:px-10 lg:py-28">
      <div class="grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
        <div>
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
            class="grid gap-2 py-6 sm:grid-cols-[13rem_1fr] sm:gap-8"
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
    </section>

    <section class="border-t border-default bg-default">
      <div class="mx-auto max-w-[78rem] px-6 py-24 text-center lg:px-10 lg:py-32">
        <h2 class="mx-auto max-w-[18ch] font-editorial text-[clamp(2.5rem,6vw,4.5rem)] leading-[1] tracking-[-0.02em] text-highlighted">
          Get your booking link.
        </h2>
        <p class="mx-auto mt-6 max-w-[42ch] text-[16px] leading-relaxed text-muted">
          Free, takes about two minutes, and your calendar comes along.
        </p>
        <UButton
          size="xl"
          class="mt-9 rounded-full px-8 font-medium"
        >
          Create your link
        </UButton>
      </div>
    </section>

    <footer class="mx-auto flex max-w-[78rem] flex-col gap-3 px-6 py-10 text-[13px] text-dimmed sm:flex-row sm:items-center sm:justify-between lg:px-10">
      <SchedraMark />
      <span>No ads. No tracking. No charge per person.</span>
    </footer>
  </div>
</template>
