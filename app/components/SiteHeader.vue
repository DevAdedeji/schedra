<script setup lang="ts">
const links = [
  { label: 'Features', to: '#features' },
  { label: 'Engine', to: '#engine' },
  { label: 'Self-host', to: '#self-host' },
  { label: 'Docs', to: '#' }
]

const open = ref(false)
</script>

<template>
  <header class="sticky top-0 z-50 border-b border-default bg-default/85 backdrop-blur-md">
    <div class="mx-auto max-w-[100rem]">
      <div class="flex h-14 items-center gap-8 px-5 sm:px-6 md:pl-[calc(var(--rail)+3rem)] md:pr-12">
        <NuxtLink
          to="/"
          class="shrink-0"
          aria-label="Schedra home"
        >
          <SchedraMark />
        </NuxtLink>

        <nav class="hidden items-center gap-7 md:flex">
          <a
            v-for="link in links"
            :key="link.label"
            :href="link.to"
            class="text-[13px] font-medium text-muted transition-colors hover:text-highlighted"
          >{{ link.label }}</a>
        </nav>

        <div class="ml-auto flex items-center gap-1.5">
          <UColorModeButton size="sm" />
          <UButton
            to="https://github.com"
            target="_blank"
            icon="i-simple-icons-github"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Schedra on GitHub"
          />
          <UButton
            to="#get-started"
            size="sm"
            class="hidden font-medium sm:inline-flex"
          >
            Get started
          </UButton>
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            class="md:hidden"
            :icon="open ? 'i-lucide-x' : 'i-lucide-menu'"
            :aria-expanded="open"
            aria-label="Toggle navigation"
            @click="open = !open"
          />
        </div>
      </div>

      <nav
        v-if="open"
        class="border-t border-default px-5 py-3 md:hidden"
      >
        <a
          v-for="link in links"
          :key="link.label"
          :href="link.to"
          class="block py-2.5 text-sm font-medium text-muted transition-colors hover:text-highlighted"
          @click="open = false"
        >{{ link.label }}</a>
      </nav>
    </div>
  </header>
</template>
