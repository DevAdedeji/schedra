<template>
  <div class="min-h-screen bg-muted">
    <header class="border-b border-default bg-default">
      <div class="mx-auto flex h-16 max-w-[52rem] items-center justify-between px-6">
        <NuxtLink
          to="/dashboard"
          aria-label="Schedra"
        >
          <SchedraMark />
        </NuxtLink>
        <UColorModeButton size="sm" />
      </div>
    </header>

    <main class="mx-auto max-w-[52rem] px-6 py-12">
      <slot />
    </main>
  </div>
</template>
