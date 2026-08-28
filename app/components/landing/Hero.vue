<script setup lang="ts">
const { isSignedIn, accountDestination } = await useLandingNavigation()
</script>

<template>
  <section class="bg-muted">
    <div class="mx-auto max-w-312 px-6 pb-20 pt-16 lg:px-10 lg:pb-28 lg:pt-24">
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
            Schedra brings availability, bookings and follow-ups into one
            seamless scheduling experience. Share your link, let guests choose
            a time that works and automate everything that follows—from
            confirmations and reminders to rescheduling and cancellations.
          </p>

          <div class="mt-10 flex flex-wrap items-center gap-3">
            <UButton
              :to="accountDestination"
              prefetch
              size="xl"
              class="rounded-full px-7 font-medium"
            >
              {{ isSignedIn ? 'Go to dashboard' : 'Create your link' }}
            </UButton>
            <UButton
              to="#how"
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
            For people who never want to send
            <em class="font-editorial text-[16px] not-italic text-toned">“does Tuesday work?”</em>
            again.
          </p>
        </div>

        <div class="relative min-w-0">
          <div
            class="absolute inset-0 rounded-4xl bg-primary/10 sm:-inset-6 sm:-rotate-2"
            aria-hidden="true"
          />
          <div class="relative rounded-2xl bg-default p-2 shadow-2xl ring-1 ring-black/5">
            <ClientOnly>
              <BookingDemo />
              <template #fallback>
                <div class="h-104 rounded-lg bg-muted" />
              </template>
            </ClientOnly>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
