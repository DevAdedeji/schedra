<script setup lang="ts">
const zones = [
  { city: 'Lagos', country: 'Nigeria', time: '23:30', date: 'Tue 18 Aug' },
  { city: 'London', country: 'United Kingdom', time: '23:30', date: 'Tue 18 Aug' },
  { city: 'New York', country: 'United States', time: '18:30', date: 'Tue 18 Aug' },
  { city: 'Tokyo', country: 'Japan', time: '07:30', date: 'Wed 19 Aug', rollover: true }
]
</script>

<template>
  <section
    id="timezones"
    class="border-y border-default bg-default"
  >
    <div class="mx-auto max-w-312 px-6 py-20 lg:px-10 lg:py-28">
      <div class="grid items-center gap-14 lg:grid-cols-[1fr_0.9fr] lg:gap-20">
        <div>
          <p class="eyebrow text-dimmed">
            Timezones
          </p>
          <h2 class="mt-6 max-w-[14ch] font-editorial text-[clamp(2.25rem,5vw,3.75rem)] leading-[1.02] tracking-[-0.02em] text-highlighted">
            Nobody turns up an hour <em class="text-primary">late.</em>
          </h2>
          <p class="mt-7 max-w-[44ch] text-[16px] leading-[1.65] text-toned">
            You are in Lagos. They are in New York. You each see your own clock,
            and neither of you has to work anything out.
          </p>
          <p class="mt-4 max-w-[44ch] text-[16px] leading-[1.65] text-muted">
            Twice a year the clocks change, on different days in different
            countries. That is when scheduling tools quietly put meetings in the
            wrong hour. It is the part we built first, and the part we test
            hardest.
          </p>
        </div>

        <div class="overflow-hidden rounded-2xl border border-default bg-muted shadow-sm">
          <div class="border-b border-default px-5 py-3">
            <span class="eyebrow text-dimmed">
              One meeting, four cities
            </span>
          </div>

          <div class="divide-y divide-default">
            <div
              v-for="entry in zones"
              :key="entry.city"
              class="flex items-center gap-4 px-5 py-4"
            >
              <div class="min-w-0 flex-1">
                <p class="text-[15px] font-semibold tracking-tight text-highlighted">
                  {{ entry.city }}
                </p>
                <p class="truncate text-[12px] text-dimmed">
                  {{ entry.country }}
                </p>
              </div>
              <div class="w-24 shrink-0 text-right">
                <p
                  class="tnum font-editorial text-[24px] leading-none"
                  :class="entry.rollover ? 'text-primary' : 'text-highlighted'"
                >
                  {{ entry.time }}
                </p>
                <p
                  class="tnum mt-1 text-[11px]"
                  :class="entry.rollover ? 'text-primary' : 'text-dimmed'"
                >
                  {{ entry.date }}
                </p>
              </div>
            </div>
          </div>

          <p class="border-t border-default px-5 py-4 text-[13px] leading-relaxed text-muted">
            It is already tomorrow in Tokyo. Everyone still sees the right time
            on their own calendar.
          </p>
        </div>
      </div>
    </div>
  </section>
</template>
