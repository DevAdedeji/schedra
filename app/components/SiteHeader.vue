<script setup lang="ts">
const links = [
  { label: 'How it works', to: '#how' },
  { label: 'What you get', to: '#features' },
  { label: 'For developers', to: '#developers' }
]

const open = ref(false)
</script>

<template>
  <header class="sticky top-0 z-50 border-b border-default bg-muted/85 backdrop-blur-md">
    <div class="mx-auto max-w-312 px-6 lg:px-10">
      <div class="flex h-16 items-center justify-between gap-8">
        <NuxtLink
          to="/"
          aria-label="Schedra home"
        >
          <SchedraMark />
        </NuxtLink>

        <nav class="hidden items-center gap-8 md:flex">
          <a
            v-for="link in links"
            :key="link.label"
            :href="link.to"
            class="text-[14px] text-muted transition-colors hover:text-highlighted"
          >{{ link.label }}</a>
        </nav>

        <div class="flex items-center gap-2">
          <UColorModeButton size="sm" />
          <UButton
            to="/signup"
            size="sm"
            class="hidden rounded-full px-4 font-medium sm:inline-flex"
          >
            Sign up free
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
        class="border-t border-default py-3 md:hidden"
      >
        <a
          v-for="link in links"
          :key="link.label"
          :href="link.to"
          class="block py-2.5 text-[15px] text-muted transition-colors hover:text-highlighted"
          @click="open = false"
        >{{ link.label }}</a>
      </nav>
    </div>
  </header>
</template>
