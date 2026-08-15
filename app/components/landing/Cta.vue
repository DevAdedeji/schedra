<script setup lang="ts">
const COMMAND = 'docker compose up -d'
const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

async function copy() {
  try {
    await navigator.clipboard.writeText(COMMAND)
    copied.value = true
    clearTimeout(timer)
    timer = setTimeout(() => (copied.value = false), 1600)
  } catch {
    // Clipboard unavailable (insecure origin, denied permission) — the command
    // is still selectable by hand, so there is nothing useful to report.
  }
}

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <GridSection
    id="get-started"
    :rail="['10', '11', '12', '13']"
    muted
  >
    <div class="py-20 lg:py-28">
      <div class="max-w-3xl">
        <h2 class="text-[clamp(2.25rem,6vw,4.5rem)] font-semibold leading-[0.94] tracking-[-0.045em] text-highlighted">
          Take your<br>
          calendar <span class="text-primary">back.</span>
        </h2>

        <p class="mt-7 max-w-[48ch] text-[15px] leading-relaxed text-muted sm:text-base">
          Schedra is early and building in the open. Star the repository, run it
          locally, and tell us what breaks.
        </p>

        <div class="mt-10 flex flex-wrap items-center gap-3">
          <UButton
            to="https://github.com"
            target="_blank"
            class="font-medium"
          >
            Star on GitHub
          </UButton>
          <UButton
            to="#"
            color="neutral"
            variant="outline"
            class="font-medium"
            trailing-icon="i-lucide-arrow-right"
          >
            Read the docs
          </UButton>
        </div>

        <button
          type="button"
          class="mt-10 flex items-center gap-3 border border-default bg-default px-4 py-3 font-mono text-[12px] transition-colors hover:border-accented"
          :aria-label="`Copy command: ${COMMAND}`"
          @click="copy"
        >
          <span class="text-dimmed">$</span>
          <span class="text-highlighted">{{ COMMAND }}</span>
          <UIcon
            :name="copied ? 'i-lucide-check' : 'i-lucide-copy'"
            class="size-3.5 shrink-0"
            :class="copied ? 'text-primary' : 'text-dimmed'"
          />
        </button>
      </div>
    </div>
  </GridSection>
</template>
