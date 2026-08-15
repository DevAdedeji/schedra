<script setup lang="ts">
interface Cell {
  icon: string
  title: string
  body: string
}

/**
 * Laid out as a schedule: `null` cells are free time. They give the grid its
 * rhythm and stop the section reading as a generic feature wall.
 */
const cells: (Cell | null)[] = [
  {
    icon: 'i-lucide-layers',
    title: 'Event types',
    body: 'One-on-one, group, round-robin and collective. Custom durations, locations and questions.'
  },
  {
    icon: 'i-lucide-clock',
    title: 'Availability',
    body: 'Weekly hours, date overrides, buffers, minimum notice, booking windows and daily caps.'
  },
  null,
  {
    icon: 'i-lucide-calendar-sync',
    title: 'Calendar sync',
    body: 'Google, Outlook and CalDAV. Two-way, conflict-aware, and reconciled in the background.'
  },
  null,
  {
    icon: 'i-lucide-globe',
    title: 'Timezones done right',
    body: 'IANA zones, never raw offsets. DST transitions are handled explicitly and tested.'
  },
  {
    icon: 'i-lucide-link',
    title: 'Booking pages',
    body: 'Server-rendered, keyboard-accessible and fast. Brand them, embed them, or both.'
  },
  null,
  {
    icon: 'i-lucide-users',
    title: 'Teams',
    body: 'Organizations, roles, shared availability and fair round-robin. Not an enterprise upsell.'
  },
  null,
  {
    icon: 'i-lucide-webhook',
    title: 'API & webhooks',
    body: 'REST with an OpenAPI spec, signed webhooks with retries, and an embeddable widget.'
  },
  {
    icon: 'i-lucide-mail',
    title: 'Notifications',
    body: 'Confirmations, reminders, reschedules and cancellations through any SMTP server.'
  }
]
</script>

<template>
  <GridSection
    id="features"
    :rail="['15', '16', '17', '18', '19', '20', '21']"
  >
    <div class="py-16 lg:py-24">
      <header class="max-w-2xl">
        <p class="font-mono text-[10px] uppercase tracking-[0.22em] text-dimmed">
          Features
        </p>
        <h2 class="mt-5 text-[clamp(1.9rem,4vw,3rem)] font-semibold leading-[1.02] tracking-[-0.04em] text-highlighted">
          Everything a scheduling tool owes you.
        </h2>
        <p class="mt-5 text-[15px] leading-relaxed text-muted">
          No feature held back for a paid tier. If it ships, you can run it.
        </p>
      </header>

      <div class="mt-14 grid gap-px border border-default bg-border sm:grid-cols-2 lg:grid-cols-4">
        <template
          v-for="(cell, index) in cells"
          :key="index"
        >
          <div
            v-if="cell"
            class="group bg-default p-6 transition-colors hover:bg-muted"
          >
            <div class="flex items-center justify-between">
              <UIcon
                :name="cell.icon"
                class="size-5 text-primary"
              />
              <span class="tnum font-mono text-[10px] text-dimmed">
                {{ String(index + 1).padStart(2, '0') }}
              </span>
            </div>
            <h3 class="mt-9 text-[15px] font-semibold tracking-tight text-highlighted">
              {{ cell.title }}
            </h3>
            <p class="mt-2 text-[13px] leading-relaxed text-muted">
              {{ cell.body }}
            </p>
          </div>

          <!-- Free time. -->
          <div
            v-else
            class="hidden bg-default lg:block"
          />
        </template>
      </div>
    </div>
  </GridSection>
</template>
