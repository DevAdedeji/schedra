<template>
  <GridSection :rail="['09', '10', '11', '12', '13', '14']">
    <div class="grid gap-12 py-16 lg:grid-cols-[1.1fr_23rem] lg:gap-16 lg:py-24">
      <div>
        <p class="font-mono text-[10px] uppercase tracking-[0.22em] text-dimmed">
          Open source · Self-hosted · Your infrastructure
        </p>

        <h1 class="mt-6 text-[clamp(2.75rem,6.6vw,5.25rem)] font-semibold leading-[0.9] tracking-[-0.045em] text-highlighted">
          Scheduling<br>
          without the<br>
          <span class="text-primary">middleman.</span>
        </h1>

        <p class="mt-7 max-w-[46ch] text-[15px] leading-relaxed text-muted sm:text-base">
          Schedra is an open-source booking platform you run yourself. One
          container, one Postgres, ten environment variables. Your calendar
          data never touches anyone else's infrastructure.
        </p>

        <div class="mt-9 flex flex-wrap items-center gap-3">
          <UButton
            to="#get-started"
            class="font-medium"
          >
            Get started
          </UButton>
          <UButton
            to="#self-host"
            color="neutral"
            variant="outline"
            class="font-medium"
            trailing-icon="i-lucide-arrow-right"
          >
            Self-host in 60 seconds
          </UButton>
        </div>

        <dl class="mt-12 grid max-w-lg grid-cols-3 gap-px border-y border-default bg-border">
          <div
            v-for="stat in stats"
            :key="stat.label"
            class="bg-default py-4"
          >
            <dt class="font-mono text-[10px] uppercase tracking-[0.14em] text-dimmed">
              {{ stat.label }}
            </dt>
            <dd class="mt-1.5 text-[15px] font-semibold tracking-tight text-highlighted">
              {{ stat.value }}
            </dd>
          </div>
        </dl>
      </div>

      <div class="lg:pt-2">
        <ClientOnly>
          <BookingDemo />
          <template #fallback>
            <div class="h-[26rem] border border-default bg-muted" />
          </template>
        </ClientOnly>

        <p class="mt-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-dimmed">
          <UIcon
            name="i-lucide-corner-left-up"
            class="size-3.5"
          />
          Real widget — pick a slot
        </p>
      </div>
    </div>
  </GridSection>
</template>

<script setup lang="ts">
const stats = [
  { label: 'Runtime deps', value: 'Postgres' },
  { label: 'Setup', value: 'One command' },
  { label: 'Seat pricing', value: 'None' }
]
</script>
