<script setup lang="ts">
/**
 * One instant — 2026-08-18T22:30:00Z — rendered in four zones. Hardcoded
 * rather than computed so the prerendered HTML and the hydrated client can
 * never disagree, and so the illustration stays stable forever.
 */
const zones = [
  { city: 'Lagos', zone: 'Africa/Lagos', abbr: 'WAT', offset: 'UTC+1', time: '23:30', date: 'Tue 18 Aug' },
  { city: 'London', zone: 'Europe/London', abbr: 'BST', offset: 'UTC+1', time: '23:30', date: 'Tue 18 Aug' },
  { city: 'New York', zone: 'America/New_York', abbr: 'EDT', offset: 'UTC−4', time: '18:30', date: 'Tue 18 Aug' },
  { city: 'Tokyo', zone: 'Asia/Tokyo', abbr: 'JST', offset: 'UTC+9', time: '07:30', date: 'Wed 19 Aug', rollover: true }
]

const cases = [
  'Spring-forward — 02:30 does not exist',
  'Fall-back — 01:30 happens twice',
  'Overnight window crossing midnight',
  'Kathmandu +05:45, Chatham +12:45',
  'Lord Howe — 30-minute DST shift',
  'Buffer overflowing a window edge'
]
</script>

<template>
  <GridSection
    id="engine"
    :rail="['22', '23', '00', '01', '02', '03']"
    muted
  >
    <div class="py-16 lg:py-24">
      <div class="grid gap-14 lg:grid-cols-[1fr_1.05fr] lg:gap-20">
        <div>
          <p class="font-mono text-[10px] uppercase tracking-[0.22em] text-dimmed">
            The engine
          </p>
          <h2 class="mt-5 text-[clamp(1.9rem,4vw,3rem)] font-semibold leading-[1.02] tracking-[-0.04em] text-highlighted">
            One meeting.<br>
            Every timezone.<br>
            <span class="text-primary">Correct.</span>
          </h2>
          <p class="mt-6 max-w-[48ch] text-[15px] leading-relaxed text-muted">
            Most scheduling bugs are timezone bugs, and they are silent — a
            booking lands an hour off on the one Sunday a year the clocks move.
            Schedra stores recurring hours as wall-clock time plus an IANA zone,
            never as a fixed offset, and resolves them through an engine with no
            database access and no HTTP.
          </p>

          <dl class="mt-9 space-y-4 border-l-2 border-primary pl-5">
            <div>
              <dt class="font-mono text-[10px] uppercase tracking-[0.14em] text-dimmed">
                Stored
              </dt>
              <dd class="mt-1 text-[13px] leading-relaxed text-toned">
                <code class="font-mono text-highlighted">09:00</code> +
                <code class="font-mono text-highlighted">Africa/Lagos</code> —
                a wall clock and a place
              </dd>
            </div>
            <div>
              <dt class="font-mono text-[10px] uppercase tracking-[0.14em] text-dimmed">
                Never stored
              </dt>
              <dd class="mt-1 text-[13px] leading-relaxed text-toned">
                <code class="font-mono text-highlighted">+01:00</code> —
                offsets change twice a year, zones don't
              </dd>
            </div>
          </dl>
        </div>

        <div>
          <div class="border border-default bg-default">
            <div class="flex items-center justify-between border-b border-default px-4 py-2.5">
              <span class="font-mono text-[10px] uppercase tracking-[0.16em] text-dimmed">
                Same instant
              </span>
              <span class="tnum font-mono text-[10px] text-dimmed">
                2026-08-18T22:30:00Z
              </span>
            </div>

            <div class="divide-y divide-default">
              <div
                v-for="entry in zones"
                :key="entry.zone"
                class="flex items-center gap-4 px-4 py-3.5"
              >
                <div class="min-w-0 flex-1">
                  <p class="text-[13px] font-semibold tracking-tight text-highlighted">
                    {{ entry.city }}
                  </p>
                  <p class="truncate font-mono text-[10px] text-dimmed">
                    {{ entry.zone }}
                  </p>
                </div>
                <span class="tnum shrink-0 font-mono text-[10px] text-muted">
                  {{ entry.abbr }} · {{ entry.offset }}
                </span>
                <div class="w-[5.5rem] shrink-0 text-right">
                  <p
                    class="tnum text-[17px] font-semibold tracking-tight"
                    :class="entry.rollover ? 'text-primary' : 'text-highlighted'"
                  >
                    {{ entry.time }}
                  </p>
                  <p
                    class="tnum font-mono text-[10px]"
                    :class="entry.rollover ? 'text-primary' : 'text-dimmed'"
                  >
                    {{ entry.date }}
                  </p>
                </div>
              </div>
            </div>

            <p class="border-t border-default px-4 py-3 font-mono text-[10px] leading-relaxed text-dimmed">
              Tokyo is already on the next day. The engine resolves this before a
              slot is ever offered.
            </p>
          </div>

          <div class="mt-8">
            <p class="font-mono text-[10px] uppercase tracking-[0.16em] text-dimmed">
              Tested against
            </p>
            <ul class="mt-4 grid gap-px bg-border sm:grid-cols-2">
              <li
                v-for="item in cases"
                :key="item"
                class="flex items-start gap-2.5 bg-muted py-2.5 pr-3 text-[12px] leading-snug text-toned"
              >
                <UIcon
                  name="i-lucide-check"
                  class="mt-0.5 size-3.5 shrink-0 text-primary"
                />
                {{ item }}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </GridSection>
</template>
