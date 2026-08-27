<script setup lang="ts">
const previewOpen = ref(true)
const { isSignedIn, accountDestination } = await useLandingNavigation()
const embedDestination = computed(() => isSignedIn.value ? '/event-types' : accountDestination.value)

const benefits = [
  ['Stay on your website', 'Visitors choose a time in a focused overlay instead of being sent to another tab.'],
  ['One snippet to install', 'Paste the generated code once. Updates to your event type appear everywhere automatically.'],
  ['Designed to belong', 'Match the light or dark theme and accent colour to the site your visitors already know.']
]
</script>

<template>
  <section
    id="embed"
    class="overflow-hidden border-y border-default bg-default"
  >
    <div class="mx-auto max-w-312 px-6 py-20 lg:px-10 lg:py-28">
      <div class="grid items-center gap-14 lg:grid-cols-[0.82fr_1.18fr] lg:gap-20">
        <div>
          <p class="eyebrow text-primary">
            Embedded booking
          </p>
          <h2 class="mt-6 max-w-[13ch] font-editorial text-[clamp(2.4rem,5vw,4rem)] leading-[1.02] tracking-[-0.02em] text-highlighted">
            Let them book without leaving your site.
          </h2>
          <p class="mt-7 max-w-[44ch] text-[16px] leading-[1.65] text-toned">
            Open the complete Schedra booking flow over any website. Your visitor
            stays in context, your availability stays current, and the booking
            still reaches every calendar and reminder you configured.
          </p>

          <dl class="mt-9 space-y-6">
            <div
              v-for="[title, body] in benefits"
              :key="title"
              class="grid grid-cols-[1.5rem_1fr] gap-3"
            >
              <UIcon
                name="i-lucide-check"
                class="mt-1 size-4 text-primary"
                aria-hidden="true"
              />
              <div>
                <dt class="text-[15px] font-semibold tracking-tight text-highlighted">
                  {{ title }}
                </dt>
                <dd class="mt-1 max-w-[42ch] text-[14px] leading-relaxed text-muted">
                  {{ body }}
                </dd>
              </div>
            </div>
          </dl>

          <div class="mt-10 flex flex-wrap items-center gap-3">
            <UButton
              :to="embedDestination"
              prefetch
              size="lg"
              class="rounded-full px-6 font-medium"
              trailing-icon="i-lucide-arrow-right"
            >
              {{ isSignedIn ? 'Create an embed' : 'Create your booking page' }}
            </UButton>
            <UButton
              type="button"
              size="lg"
              color="neutral"
              variant="outline"
              class="rounded-full px-6 font-medium"
              @click="previewOpen = true"
            >
              Preview the overlay
            </UButton>
          </div>
        </div>

        <div class="relative min-w-0">
          <div
            class="absolute -inset-6 rounded-[2.5rem] bg-primary/8 blur-2xl"
            aria-hidden="true"
          />

          <div class="relative overflow-hidden rounded-2xl border border-default bg-muted shadow-2xl">
            <div class="flex h-11 items-center gap-2 border-b border-default bg-default px-4">
              <span class="size-2.5 rounded-full bg-error/70" />
              <span class="size-2.5 rounded-full bg-warning/70" />
              <span class="size-2.5 rounded-full bg-success/70" />
              <div class="mx-auto flex h-6 w-[55%] items-center justify-center rounded-md bg-muted px-3 text-[10px] text-dimmed">
                northstar.studio
              </div>
              <span class="w-6" />
            </div>

            <div class="relative min-h-136 overflow-hidden bg-default p-6 sm:p-9">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-highlighted">
                  <span class="grid size-6 place-items-center rounded-md bg-highlighted text-inverted">N</span>
                  Northstar
                </div>
                <div class="hidden items-center gap-5 text-[11px] text-muted sm:flex">
                  <span>Work</span>
                  <span>Services</span>
                  <span>About</span>
                </div>
              </div>

              <div class="mx-auto max-w-md py-18 text-center sm:py-22">
                <p class="eyebrow text-primary">
                  Product studio
                </p>
                <h3 class="mt-5 font-editorial text-[clamp(2rem,5vw,3.5rem)] leading-[0.98] tracking-tight text-highlighted">
                  Bring the next good idea into focus.
                </h3>
                <p class="mx-auto mt-5 max-w-[38ch] text-[13px] leading-relaxed text-muted">
                  Strategy, identity and digital products for teams building something worth remembering.
                </p>
                <UButton
                  type="button"
                  size="sm"
                  class="mt-7 rounded-full px-5"
                  @click="previewOpen = true"
                >
                  Book a call
                </UButton>
              </div>

              <Transition
                enter-active-class="transition duration-200 ease-out"
                enter-from-class="opacity-0"
                enter-to-class="opacity-100"
                leave-active-class="transition duration-150 ease-in"
                leave-from-class="opacity-100"
                leave-to-class="opacity-0"
              >
                <div
                  v-if="previewOpen"
                  class="absolute inset-0 grid place-items-center bg-black/55 p-4 backdrop-blur-[2px] sm:p-7"
                >
                  <div class="w-full max-w-md overflow-hidden rounded-2xl border border-default bg-default shadow-2xl">
                    <div class="flex items-start justify-between gap-6 border-b border-default px-5 py-4">
                      <div>
                        <p class="text-[11px] font-medium uppercase tracking-[0.13em] text-primary">
                          Schedra booking
                        </p>
                        <h4 class="mt-1 text-[18px] font-semibold tracking-tight text-highlighted">
                          Design introduction
                        </h4>
                        <p class="mt-1 text-[12px] text-muted">
                          30 minutes · Video call
                        </p>
                      </div>
                      <button
                        type="button"
                        class="grid size-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-muted hover:text-highlighted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        aria-label="Close booking preview"
                        @click="previewOpen = false"
                      >
                        <UIcon
                          name="i-lucide-x"
                          class="size-4"
                        />
                      </button>
                    </div>

                    <div class="grid gap-5 p-5 sm:grid-cols-[0.82fr_1.18fr]">
                      <div>
                        <p class="text-[11px] font-semibold uppercase tracking-[0.1em] text-dimmed">
                          August 2026
                        </p>
                        <div class="mt-4 grid grid-cols-4 gap-2">
                          <span class="rounded-lg bg-muted py-2 text-center text-[11px] text-muted">24</span>
                          <span class="rounded-lg bg-primary py-2 text-center text-[11px] font-semibold text-inverted">25</span>
                          <span class="rounded-lg bg-muted py-2 text-center text-[11px] text-muted">26</span>
                          <span class="rounded-lg bg-muted py-2 text-center text-[11px] text-muted">27</span>
                        </div>
                        <p class="mt-4 text-[11px] leading-relaxed text-muted">
                          Times shown in your timezone
                        </p>
                      </div>
                      <div class="grid grid-cols-2 gap-2 content-start">
                        <button
                          v-for="time in ['09:00', '09:30', '10:30', '11:00', '13:30', '15:00']"
                          :key="time"
                          type="button"
                          class="h-9 rounded-lg border border-default bg-muted text-[12px] font-medium text-highlighted transition-colors hover:border-primary hover:text-primary"
                        >
                          {{ time }}
                        </button>
                      </div>
                    </div>

                    <p class="border-t border-default px-5 py-3 text-center text-[10px] text-dimmed">
                      Secure booking by Schedra · no redirect
                    </p>
                  </div>
                </div>
              </Transition>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
