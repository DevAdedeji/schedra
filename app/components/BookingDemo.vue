<script setup lang="ts">
/**
 * A real, working slot picker — not a screenshot. Availability is generated
 * deterministically from the date, so the demo is stable between renders while
 * still reacting honestly to today's date, the weekend, and a two-hour minimum
 * notice window.
 *
 * Rendered inside <ClientOnly> because everything here derives from the
 * visitor's own clock and timezone; the page itself is prerendered.
 */

interface Slot {
  time: string
  taken: boolean
}

const HOST = {
  name: 'Adedeji T.',
  initials: 'AT',
  event: 'Intro call',
  duration: 30
}

const BASE_SLOTS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'
]

const DAYS_AHEAD = 60
const MIN_NOTICE_MS = 2 * 60 * 60 * 1000

/** Constructing from parts (never mutating) keeps these local-midnight dates
 *  correct across DST boundaries — the same rule the real engine follows. */
function addDays(date: Date, count: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count)
}

function startOfWeek(date: Date) {
  return addDays(date, -((date.getDay() + 6) % 7))
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

/** Stable pseudo-random in [0,1) — the same day always yields the same grid. */
function noise(seed: number, index: number) {
  const value = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453
  return value - Math.floor(value)
}

const now = new Date()
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
const horizon = addDays(today, DAYS_AHEAD)

function slotsFor(date: Date): Slot[] {
  const weekday = date.getDay()
  if (weekday === 0 || weekday === 6) return []
  if (date < today || date > horizon) return []

  const seed = date.getFullYear() * 372 + (date.getMonth() + 1) * 31 + date.getDate()
  return BASE_SLOTS.map((time, index) => ({
    time,
    taken: noise(seed, index) < 0.38
  }))
}

/** Slots inside the minimum-notice window are never offered. */
function tooSoon(date: Date, time: string) {
  if (!sameDay(date, today)) return false
  const [hour, minute] = time.split(':').map(Number)
  const at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute)
  return at.getTime() < now.getTime() + MIN_NOTICE_MS
}

function openSlotsFor(date: Date) {
  return slotsFor(date).filter(slot => !slot.taken && !tooSoon(date, slot.time))
}

function firstOpenDay() {
  for (let i = 0; i <= DAYS_AHEAD; i++) {
    const date = addDays(today, i)
    if (openSlotsFor(date).length) return date
  }
  return today
}

const initialDay = firstOpenDay()
const thisWeek = startOfWeek(today)

const weekOffset = ref(
  Math.round((startOfWeek(initialDay).getTime() - thisWeek.getTime()) / 6048e5)
)
const selected = ref<Date>(initialDay)
const picked = ref<string | null>(null)
const confirmed = ref(false)

const weekStart = computed(() => addDays(thisWeek, weekOffset.value * 7))
const days = computed(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart.value, i)))
const openSlots = computed(() => openSlotsFor(selected.value))
const conflicts = computed(() => slotsFor(selected.value).filter(slot => slot.taken).length)

const canGoBack = computed(() => weekOffset.value > 0)
const canGoForward = computed(() => addDays(weekStart.value, 7) <= horizon)

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
const offset = new Intl.DateTimeFormat('en', { timeZoneName: 'shortOffset' })
  .formatToParts(now)
  .find(part => part.type === 'timeZoneName')?.value ?? ''

const weekdayOf = new Intl.DateTimeFormat('en', { weekday: 'narrow' })
const longDate = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long' })
const monthLabel = computed(() =>
  new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(weekStart.value)
)

function select(date: Date) {
  if (!openSlotsFor(date).length) return
  selected.value = date
  picked.value = null
  confirmed.value = false
}

function reset() {
  confirmed.value = false
  picked.value = null
}
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-default bg-default">
    <!-- Host -->
    <div class="flex items-center gap-3 border-b border-default px-4 py-3.5">
      <span class="flex size-9 shrink-0 items-center justify-center bg-inverted text-[11px] font-medium tracking-tight text-inverted">
        {{ HOST.initials }}
      </span>
      <div class="min-w-0">
        <p class="truncate text-[13px] font-semibold leading-tight text-highlighted">
          {{ HOST.name }}
        </p>
        <p class="truncate text-[12px] leading-tight text-muted">
          {{ HOST.event }} · {{ HOST.duration }} min
        </p>
      </div>
      <span class="ml-auto flex shrink-0 items-center gap-1.5 eyebrow text-[9px] text-dimmed">
        <span class="size-1.5 bg-primary" />
        Live
      </span>
    </div>

    <!-- Week navigation -->
    <div class="flex items-center justify-between border-b border-default px-4 py-2.5">
      <span class="eyebrow text-highlighted">
        {{ monthLabel }}
      </span>
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="flex size-6 items-center justify-center text-muted transition-colors hover:text-highlighted disabled:opacity-25 disabled:hover:text-muted"
          :disabled="!canGoBack"
          aria-label="Previous week"
          @click="weekOffset--"
        >
          <UIcon
            name="i-lucide-chevron-left"
            class="size-4"
          />
        </button>
        <button
          type="button"
          class="flex size-6 items-center justify-center text-muted transition-colors hover:text-highlighted disabled:opacity-25 disabled:hover:text-muted"
          :disabled="!canGoForward"
          aria-label="Next week"
          @click="weekOffset++"
        >
          <UIcon
            name="i-lucide-chevron-right"
            class="size-4"
          />
        </button>
      </div>
    </div>

    <!-- Days -->
    <div class="grid grid-cols-7 gap-px border-b border-default bg-border">
      <button
        v-for="day in days"
        :key="day.toISOString()"
        type="button"
        class="tnum flex flex-col items-center gap-1 bg-default py-2.5 transition-colors"
        :class="[
          openSlotsFor(day).length
            ? 'cursor-pointer hover:bg-elevated'
            : 'cursor-default text-dimmed',
          sameDay(day, selected) && 'bg-primary! text-inverted!'
        ]"
        :disabled="!openSlotsFor(day).length"
        :aria-pressed="sameDay(day, selected)"
        :aria-label="longDate.format(day)"
        @click="select(day)"
      >
        <span class="text-[9px] font-semibold uppercase tracking-widest opacity-60">
          {{ weekdayOf.format(day) }}
        </span>
        <span class="text-[13px] font-medium leading-none">{{ day.getDate() }}</span>
        <span
          class="size-1 rounded-full"
          :class="openSlotsFor(day).length
            ? (sameDay(day, selected) ? 'bg-white' : 'bg-primary')
            : 'bg-transparent'"
        />
      </button>
    </div>

    <!-- Slots -->
    <div v-if="!confirmed">
      <div class="flex items-baseline justify-between gap-3 px-4 pb-2 pt-3.5">
        <span class="truncate text-[12px] font-medium text-highlighted">
          {{ longDate.format(selected) }}
        </span>
        <span class="shrink-0 font-mono text-[10px] text-dimmed">{{ offset }}</span>
      </div>

      <div class="max-h-46 overflow-y-auto px-4 pb-3">
        <div class="grid grid-cols-3 gap-px bg-border">
          <button
            v-for="slot in openSlots"
            :key="slot.time"
            type="button"
            class="tnum bg-default py-2.5 text-center text-[12px] font-medium transition-colors"
            :class="picked === slot.time
              ? 'bg-primary! text-inverted!'
              : 'text-toned hover:bg-elevated hover:text-highlighted'"
            :aria-pressed="picked === slot.time"
            @click="picked = slot.time"
          >
            {{ slot.time }}
          </button>
        </div>

        <p
          v-if="!openSlots.length"
          class="py-6 text-center text-[12px] text-dimmed"
        >
          No availability on this day
        </p>
      </div>

      <div class="flex items-center gap-3 border-t border-default px-4 py-3">
        <p class="min-w-0 flex-1 truncate text-[11px] text-dimmed">
          <template v-if="conflicts">
            {{ conflicts }} hidden by calendar conflicts
          </template>
          <template v-else>
            {{ timezone }}
          </template>
        </p>
        <UButton
          size="sm"
          :disabled="!picked"
          class="shrink-0 font-medium"
          @click="confirmed = true"
        >
          {{ picked ? `Confirm ${picked}` : 'Select a time' }}
        </UButton>
      </div>
    </div>

    <!-- Confirmation -->
    <div
      v-else
      class="reveal px-4 py-6"
    >
      <div class="flex items-start gap-3">
        <span class="mt-0.5 flex size-6 shrink-0 items-center justify-center bg-primary">
          <UIcon
            name="i-lucide-check"
            class="size-3.5 text-white"
          />
        </span>
        <div class="min-w-0">
          <p class="text-[13px] font-semibold text-highlighted">
            Booked — {{ picked }}
          </p>
          <p class="mt-1 text-[12px] leading-relaxed text-muted">
            {{ longDate.format(selected) }} · {{ HOST.duration }} min with {{ HOST.name }}
          </p>
          <p class="mt-3 text-[11px] leading-relaxed text-dimmed">
            Calendar event created · invite sent · reminder queued
          </p>
          <button
            type="button"
            class="mt-4 eyebrow text-[10px] text-primary transition-opacity hover:opacity-70"
            @click="reset"
          >
            Book another →
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.reveal {
  animation: reveal 0.28s ease-out;
}

@keyframes reveal {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .reveal {
    animation: none;
  }
}
</style>
