<script setup lang="ts">
import type { RoutingQuestion } from '#shared/routing'
import { apiErrorMessage } from '~/services/schedra-api'

const props = defineProps<{ mode: 'personal' | 'team', owner: string, slug: string }>()
const endpoint = computed(() => props.mode === 'team'
  ? `/api/team-routing/${encodeURIComponent(props.owner)}/${encodeURIComponent(props.slug)}`
  : `/api/routing/${encodeURIComponent(props.owner)}/${encodeURIComponent(props.slug)}`)

interface PublicRoutingForm {
  title: string
  description: string | null
  ownerName: string
  questions: RoutingQuestion[]
}

const { data, status, error, refresh } = await useFetch<PublicRoutingForm>(endpoint)
const name = ref('')
const email = ref('')
const answers = reactive<Record<string, string>>({})
const submitting = ref(false)
const submitError = ref('')

useSeoMeta({
  title: () => data.value ? `${data.value.title} · ${data.value.ownerName}` : 'Find the right meeting',
  description: () => data.value?.description ?? `Find the right meeting with ${data.value?.ownerName ?? 'this host'}.`
})

async function continueToBooking() {
  if (submitting.value) return
  submitting.value = true
  submitError.value = ''
  try {
    const result = await $fetch<{ redirectUrl: string }>(endpoint.value, {
      method: 'POST',
      body: { name: name.value, email: email.value, answers }
    })
    sessionStorage.setItem(`schedra:routing-prefill:${result.redirectUrl}`, JSON.stringify({
      name: name.value.trim(),
      email: email.value.trim().toLocaleLowerCase(),
      expiresAt: Date.now() + 10 * 60 * 1000
    }))
    await navigateTo(result.redirectUrl)
  } catch (failure) {
    submitError.value = apiErrorMessage(failure, 'Could not find a booking option. Please try again.')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="min-h-screen bg-muted px-4 py-8 sm:px-6 sm:py-14">
    <div class="mx-auto max-w-2xl">
      <NuxtLink
        to="/"
        aria-label="Schedra home"
        class="mb-7 inline-flex"
      ><SchedraMark /></NuxtLink>
      <section class="overflow-hidden rounded-2xl border border-default bg-default shadow-sm">
        <AsyncErrorState
          v-if="error"
          title="This routing form is unavailable"
          description="The link may be inactive or the connection may be temporary."
          @retry="refresh"
        />
        <ListLoadingSkeleton
          v-else-if="status === 'pending'"
          label="Loading form"
        />
        <template v-else-if="data">
          <header class="border-b border-default px-5 py-6 sm:px-8 sm:py-8">
            <p class="text-[12px] font-semibold uppercase tracking-[0.16em] text-primary">
              Find the right meeting
            </p>
            <h1 class="mt-3 text-2xl font-semibold tracking-tight text-highlighted sm:text-3xl">
              {{ data.title }}
            </h1>
            <p
              v-if="data.description"
              class="mt-3 max-w-xl text-[15px] leading-6 text-muted"
            >
              {{ data.description }}
            </p>
            <p class="mt-3 text-[13px] text-dimmed">
              With {{ data.ownerName }}
            </p>
          </header>
          <form
            class="space-y-6 px-5 py-6 sm:px-8 sm:py-8"
            @submit.prevent="continueToBooking"
          >
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField
                label="Your name"
                required
              >
                <UInput
                  v-model="name"
                  autocomplete="name"
                  size="lg"
                  class="w-full"
                  placeholder="Ada Lovelace"
                />
              </UFormField>
              <UFormField
                label="Email address"
                required
              >
                <UInput
                  v-model="email"
                  type="email"
                  autocomplete="email"
                  size="lg"
                  class="w-full"
                  placeholder="ada@example.com"
                />
              </UFormField>
            </div>
            <UFormField
              v-for="question in data.questions"
              :key="question.id"
              :label="question.label"
              :required="question.required"
            >
              <USelectMenu
                v-model="answers[question.id]"
                :items="question.options"
                :aria-label="question.label"
                placeholder="Choose an answer"
                size="lg"
                class="w-full"
              />
            </UFormField>
            <p
              v-if="submitError"
              class="rounded-lg border border-error/30 bg-error/5 px-3 py-2.5 text-[13px] text-error"
              role="alert"
            >
              {{ submitError }}
            </p>
            <div class="flex justify-end">
              <UButton
                type="submit"
                size="lg"
                trailing-icon="i-lucide-arrow-right"
                :loading="submitting"
              >
                See available times
              </UButton>
            </div>
          </form>
        </template>
      </section>
      <p class="mt-5 text-center text-[12px] text-dimmed">
        Scheduling powered by Schedra
      </p>
    </div>
  </main>
</template>
