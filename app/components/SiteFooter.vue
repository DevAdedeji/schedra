<script setup lang="ts">
interface FooterLink {
  label: string
  to: string
  external?: boolean
}

const columns: { title: string, links: FooterLink[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'How it works', to: '/#how' },
      { label: 'What you get', to: '/#features' },
      { label: 'Timezones', to: '/#timezones' },
      { label: 'Self-hosting', to: '/#developers' }
    ]
  },
  {
    title: 'Account',
    links: [
      { label: 'Create your link', to: '/signup' },
      { label: 'Sign in', to: '/login' }
    ]
  },
  {
    title: 'Project',
    links: [
      { label: 'Source on GitHub', to: 'https://github.com/DevAdedeji/schedra', external: true },
      { label: 'Feature plan', to: 'https://github.com/DevAdedeji/schedra/blob/staging/FEATURES.md', external: true },
      { label: 'Readme', to: 'https://github.com/DevAdedeji/schedra#readme', external: true }
    ]
  }
]

const year = new Date().getFullYear()
</script>

<template>
  <footer class="border-t border-default bg-muted">
    <div class="mx-auto max-w-312 px-6 lg:px-10">
      <div class="grid gap-12 py-16 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <SchedraMark />
          <p class="mt-5 max-w-[28ch] text-[15px] leading-relaxed text-muted">
            Share a link, get booked. Focused scheduling with clear timezone
            handling and no third-party tracking.
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
              :key="link.label"
            >
              <NuxtLink
                :to="link.to"
                :target="link.external ? '_blank' : undefined"
                :rel="link.external ? 'noopener noreferrer' : undefined"
                class="text-[14px] text-muted transition-colors hover:text-highlighted"
              >{{ link.label }}</NuxtLink>
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
