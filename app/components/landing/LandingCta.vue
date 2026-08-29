<script setup lang="ts">
const { isSignedIn, accountDestination } = await useLandingNavigation()
</script>

<template>
  <section
    id="get-started"
    class="border-t border-default bg-default"
  >
    <div class="mx-auto max-w-312 px-6 py-24 text-center lg:px-10 lg:py-32">
      <h2 class="mx-auto max-w-[18ch] font-editorial text-[clamp(2.5rem,6vw,4.5rem)] leading-none tracking-[-0.02em] text-highlighted">
        Get your booking link.
      </h2>
      <p class="mx-auto mt-7 max-w-[42ch] text-[17px] leading-[1.65] text-muted">
        Free, takes about two minutes, and you can change your hours whenever
        you need to. No card and no trial that quietly ends.
      </p>
      <UButton
        :to="accountDestination"
        prefetch
        size="xl"
        class="mt-10 rounded-full px-8 font-medium"
      >
        {{ isSignedIn ? 'Go to dashboard' : 'Create your link' }}
      </UButton>
    </div>
  </section>
</template>
