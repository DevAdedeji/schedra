<script setup lang="ts">
import { analyticsAllowedForRoute } from '#shared/analytics'

type AnalyticsConsent = 'granted' | 'denied'
type Clarity = (
  command: 'consentv2',
  consent: { ad_Storage: AnalyticsConsent, analytics_Storage: AnalyticsConsent }
) => void

const storageKey = 'schedra:analytics-consent:v1'
const route = useRoute()
const open = ref(false)
const hasChoice = ref(false)
const excluded = computed(() => !analyticsAllowedForRoute(route.name))

function tellClarity(analytics: AnalyticsConsent) {
  const clarity = (window as typeof window & { clarity?: Clarity }).clarity
  clarity?.('consentv2', {
    // Schedra does not use Clarity for advertising.
    ad_Storage: 'denied',
    analytics_Storage: analytics
  })
}

function storeChoice(choice: AnalyticsConsent) {
  try {
    localStorage.setItem(storageKey, choice)
  } catch {
    // The current page still respects the choice when storage is unavailable.
  }
}

function choose(choice: AnalyticsConsent) {
  storeChoice(choice)
  tellClarity(choice)
  hasChoice.value = true
  open.value = false
}

function initialiseConsentControl() {
  if (import.meta.dev || excluded.value) {
    open.value = false
    return
  }

  let stored: string | null = null
  try {
    stored = localStorage.getItem(storageKey)
  } catch {
    // Treat unavailable storage as no prior choice.
  }

  if (stored === 'granted' || stored === 'denied') {
    hasChoice.value = true
    tellClarity(stored)
  } else {
    // The inline loader has already queued the same privacy-preserving default.
    tellClarity('denied')
    open.value = true
  }
}

onMounted(initialiseConsentControl)

watch(excluded, (isExcluded) => {
  if (isExcluded) open.value = false
  else initialiseConsentControl()
})
</script>

<template>
  <section
    v-if="!excluded && open"
    role="dialog"
    aria-labelledby="analytics-consent-title"
    aria-describedby="analytics-consent-description"
    aria-modal="false"
    class="fixed inset-x-3 bottom-3 z-100 mx-auto max-w-3xl rounded-2xl border border-default bg-default p-4 shadow-2xl sm:p-5"
  >
    <div class="flex items-start gap-3">
      <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
        <UIcon
          name="i-lucide-chart-no-axes-combined"
          class="size-5"
        />
      </span>

      <div class="min-w-0 flex-1">
        <h2
          id="analytics-consent-title"
          class="text-[16px] font-semibold text-highlighted"
        >
          Optional analytics
        </h2>
        <p
          id="analytics-consent-description"
          class="mt-1 text-[14px] leading-relaxed text-muted"
        >
          Help us find usability issues and improve Schedra. Sensitive form content is masked, and
          analytics are not used for advertising. Read our
          <NuxtLink
            to="/privacy"
            class="font-medium text-highlighted underline underline-offset-2"
          >privacy policy</NuxtLink>.
        </p>

        <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <UButton
            color="neutral"
            variant="outline"
            class="justify-center"
            @click="choose('denied')"
          >
            Decline
          </UButton>
          <UButton
            class="justify-center"
            @click="choose('granted')"
          >
            Allow
          </UButton>
        </div>
      </div>
    </div>
  </section>

  <UButton
    v-else-if="!excluded && hasChoice"
    color="neutral"
    variant="soft"
    size="xs"
    icon="i-lucide-shield-check"
    class="fixed bottom-3 left-3 z-50 shadow-sm"
    aria-label="Review analytics privacy choices"
    @click="open = true"
  >
    Privacy choices
  </UButton>
</template>
