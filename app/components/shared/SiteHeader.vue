<script setup lang="ts">
const links = [
  { label: 'How it works', to: '#how' },
  { label: 'Features', to: '/features' },
  { label: 'Solutions', to: '#solutions' },
  { label: 'Website embeds', to: '#embed' },
  { label: 'Pricing', to: '/pricing' }
]

const open = ref(false)
const colorMode = useColorMode()
const colorModeReady = ref(false)
const isDark = computed(() => colorModeReady.value && colorMode.value === 'dark')
const { isSignedIn, accountDestination } = await useLandingNavigation()

onMounted(() => {
  // The saved preference only exists in the browser. Keep the first client
  // render identical to SSR, then reveal the resolved icon after hydration.
  colorModeReady.value = true
})

function toggleColorMode() {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
}
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
          <NuxtLink
            v-for="link in links"
            :key="link.label"
            :to="link.to.startsWith('#') ? `/${link.to}` : link.to"
            prefetch
            class="text-[15px] text-muted transition-colors hover:text-highlighted"
          >{{ link.label }}</NuxtLink>
        </nav>

        <div class="flex items-center gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            class="size-11 justify-center"
            :icon="isDark ? 'i-lucide-sun' : 'i-lucide-moon'"
            :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
            @click="toggleColorMode"
          />
          <UButton
            :to="accountDestination"
            prefetch
            size="sm"
            class="hidden rounded-full px-4 font-medium sm:inline-flex"
          >
            {{ isSignedIn ? 'Dashboard' : 'Sign up free' }}
          </UButton>
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            class="size-11 justify-center md:hidden"
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
        <NuxtLink
          v-for="link in links"
          :key="link.label"
          :to="link.to.startsWith('#') ? `/${link.to}` : link.to"
          prefetch
          class="block py-2.5 text-[16px] text-muted transition-colors hover:text-highlighted"
          @click="open = false"
        >{{ link.label }}</NuxtLink>

        <UButton
          :to="accountDestination"
          prefetch
          block
          class="mt-3 rounded-full font-medium"
          @click="open = false"
        >
          {{ isSignedIn ? 'Dashboard' : 'Sign up free' }}
        </UButton>
      </nav>
    </div>
  </header>
</template>
