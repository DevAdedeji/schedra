<script setup lang="ts">
const columns = [
  {
    title: 'Product',
    links: ['Event types', 'Availability', 'Bookings', 'Teams', 'Embeds']
  },
  {
    title: 'Developers',
    links: ['Documentation', 'REST API', 'Webhooks', 'Self-hosting', 'Changelog']
  },
  {
    title: 'Project',
    links: ['GitHub', 'Roadmap', 'Contributing', 'License', 'Security']
  }
]

const year = new Date().getFullYear()
</script>

<template>
  <footer class="border-t border-default">
    <div class="mx-auto max-w-[100rem]">
      <div class="grid gap-10 px-5 py-14 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)] md:pl-[calc(var(--rail)+3rem)] md:pr-12">
        <div>
          <SchedraMark />
          <p class="mt-4 max-w-[26ch] text-sm leading-relaxed text-muted">
            Open-source scheduling you run yourself. Your calendar, your server,
            your data.
          </p>
        </div>

        <div
          v-for="column in columns"
          :key="column.title"
        >
          <h3 class="font-mono text-[10px] uppercase tracking-[0.18em] text-dimmed">
            {{ column.title }}
          </h3>
          <ul class="mt-4 space-y-2.5">
            <li
              v-for="link in column.links"
              :key="link"
            >
              <a
                href="#"
                class="text-sm text-muted transition-colors hover:text-highlighted"
              >{{ link }}</a>
            </li>
          </ul>
        </div>
      </div>

      <div class="flex flex-col gap-2 border-t border-default px-5 py-5 font-mono text-[11px] text-dimmed sm:flex-row sm:items-center sm:justify-between sm:px-6 md:pl-[calc(var(--rail)+3rem)] md:pr-12">
        <span>© {{ year }} Schedra — MIT licensed</span>
        <span>No trackers. No telemetry. No seat pricing.</span>
      </div>
    </div>
  </footer>
</template>
