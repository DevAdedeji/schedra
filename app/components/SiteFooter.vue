<script setup lang="ts">
const columns = [
  {
    title: 'Schedra',
    links: ['How it works', 'What you get', 'Timezones', 'Teams', 'Help']
  },
  {
    title: 'Developers',
    links: ['Documentation', 'REST API', 'Webhooks', 'Self-hosting', 'Changelog']
  },
  {
    title: 'Project',
    links: ['GitHub', 'Roadmap', 'Contributing', 'Security']
  }
]

const year = new Date().getFullYear()
</script>

<template>
  <footer class="border-t border-default bg-muted">
    <div class="mx-auto max-w-[78rem] px-6 lg:px-10">
      <div class="grid gap-12 py-16 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <SchedraMark />
          <p class="mt-5 max-w-[28ch] text-[15px] leading-relaxed text-muted">
            Share a link, get booked. Free scheduling that respects your calendar
            and your privacy.
          </p>
        </div>

        <div
          v-for="column in columns"
          :key="column.title"
        >
          <h3 class="eyebrow text-dimmed">
            {{ column.title }}
          </h3>
          <ul class="mt-5 space-y-3">
            <li
              v-for="link in column.links"
              :key="link"
            >
              <a
                href="#"
                class="text-[14px] text-muted transition-colors hover:text-highlighted"
              >{{ link }}</a>
            </li>
          </ul>
        </div>
      </div>

      <div class="flex flex-col gap-2 border-t border-default py-6 text-[13px] text-dimmed sm:flex-row sm:items-center sm:justify-between">
        <span>© {{ year }} Schedra</span>
        <span>No ads. No tracking. No charge per person.</span>
      </div>
    </div>
  </footer>
</template>
