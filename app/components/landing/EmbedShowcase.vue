<script setup lang="ts">
const previewOpen = ref(true)
const selectedPreviewTime = ref('09:30')
const selectedPreviewDay = ref('27')
const hydrated = ref(false)
const { isSignedIn, accountDestination } = await useLandingNavigation()
const embedDestination = computed(() => isSignedIn.value ? '/event-types' : accountDestination.value)

const previewDays = [
  { weekday: 'Mo', day: '24', disabled: true },
  { weekday: 'Tu', day: '25', disabled: true },
  { weekday: 'We', day: '26', disabled: true },
  { weekday: 'Th', day: '27' },
  { weekday: 'Fr', day: '28' },
  { weekday: 'Sa', day: '29', disabled: true },
  { weekday: 'Su', day: '30', disabled: true }
]

onMounted(() => {
  hydrated.value = true
})
</script>

<template>
  <section
    id="embed"
    :data-ready="hydrated"
    class="overflow-hidden border-y border-default bg-default"
  >
    <div class="mx-auto max-w-312 px-6 py-16 lg:px-10 lg:py-20">
      <div class="grid items-center gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
        <div>
          <p class="eyebrow text-primary">
            Embedded booking
          </p>
          <h2 class="mt-6 max-w-[13ch] font-editorial text-[clamp(2.4rem,5vw,4rem)] leading-[1.02] tracking-[-0.02em] text-highlighted">
            Let them book without leaving your site.
          </h2>
          <p class="mt-7 max-w-[40ch] text-[16px] leading-[1.65] text-toned">
            Add one snippet to your website. Visitors get the same timezone-aware
            booking flow in a focused overlay, while your calendars and reminders
            continue working normally.
          </p>

          <div class="mt-9 flex flex-wrap items-center gap-3">
            <UButton
              :to="embedDestination"
              prefetch
              size="lg"
              class="rounded-full px-6 font-medium"
              trailing-icon="i-lucide-arrow-right"
            >
              {{ isSignedIn ? 'Create an embed' : 'Create your booking page' }}
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
                <p class="mt-3 text-[10px] text-dimmed">
                  Opens the booking flow on this page
                </p>
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
                  <div class="w-full max-w-2xl overflow-hidden rounded-2xl border border-default bg-default shadow-2xl">
                    <div class="flex items-center justify-between gap-6 border-b border-default px-5 py-3">
                      <p class="text-[11px] font-medium uppercase tracking-[0.13em] text-primary">
                        Scheduling by Schedra
                      </p>
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

                    <div class="grid sm:grid-cols-[13rem_1fr]">
                      <aside class="border-b border-default p-5 text-left sm:border-b-0 sm:border-r">
                        <p class="text-[12px] text-muted">
                          Adedeji T.
                        </p>
                        <h4 class="mt-1 font-editorial text-[23px] leading-tight text-highlighted">
                          30mins
                        </h4>
                        <div class="mt-5 space-y-2 text-[12px] text-toned">
                          <p class="flex items-center gap-2">
                            <UIcon
                              name="i-lucide-clock"
                              class="size-3.5 text-dimmed"
                            />
                            30 minutes
                          </p>
                          <p class="flex items-center gap-2">
                            <UIcon
                              name="i-lucide-video"
                              class="size-3.5 text-dimmed"
                            />
                            Google Meet
                          </p>
                          <p class="flex items-center gap-2">
                            <UIcon
                              name="i-lucide-globe"
                              class="size-3.5 text-dimmed"
                            />
                            Africa/Lagos
                          </p>
                        </div>
                      </aside>
                      <div class="surface-secondary p-5 text-left">
                        <p class="text-[12px] font-semibold text-highlighted">
                          August 2026
                        </p>
                        <div class="mt-3 grid grid-cols-7 gap-1">
                          <button
                            v-for="day in previewDays"
                            :key="day.day"
                            type="button"
                            class="rounded-lg py-1.5 text-center transition-colors"
                            :class="selectedPreviewDay === day.day
                              ? 'bg-primary text-inverted'
                              : day.disabled
                                ? 'cursor-not-allowed text-dimmed opacity-40'
                                : 'text-highlighted hover:bg-muted'"
                            :disabled="day.disabled"
                            :aria-label="`${day.weekday} August ${day.day}`"
                            :aria-pressed="selectedPreviewDay === day.day"
                            @click="selectedPreviewDay = day.day; selectedPreviewTime = ''"
                          >
                            <span class="block text-[8px] font-semibold uppercase opacity-70">{{ day.weekday }}</span>
                            <span class="mt-0.5 block text-[11px] font-semibold">{{ day.day }}</span>
                          </button>
                        </div>
                        <p class="mt-4 text-[11px] font-medium text-muted">
                          {{ selectedPreviewDay === '27' ? 'Thursday, August 27' : 'Friday, August 28' }}
                        </p>
                        <div class="mt-2 grid grid-cols-3 gap-2 content-start">
                          <button
                            v-for="time in ['09:00', '09:30', '10:30', '11:00', '13:30', '15:00']"
                            :key="time"
                            type="button"
                            class="h-9 rounded-lg border text-[11px] font-medium transition-colors"
                            :class="selectedPreviewTime === time
                              ? 'border-primary bg-primary text-inverted'
                              : 'border-default text-toned hover:border-primary'"
                            :aria-pressed="selectedPreviewTime === time"
                            @click="selectedPreviewTime = time"
                          >
                            {{ time }}
                          </button>
                        </div>
                      </div>
                    </div>
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
