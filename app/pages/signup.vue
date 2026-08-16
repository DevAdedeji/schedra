<script setup lang="ts">
definePageMeta({ layout: 'auth', middleware: 'guest' })
useHead({ title: 'Create your Schedra link' })

const { signUp } = useAuthClient()
const { data: methods } = await useFetch('/api/auth-methods', { key: 'auth-methods' })

const name = ref('')
const username = ref('')
const email = ref('')
const password = ref('')
const touched = ref(false)
const pending = ref(false)
const error = ref('')

const strength = usePasswordStrength(password)

function normalise(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-/, '')
    .slice(0, 32)
}

watch(username, (value) => {
  const cleaned = normalise(value)
  if (cleaned !== value) username.value = cleaned
})

watch(name, (value) => {
  if (!touched.value) username.value = normalise(value)
})

interface Availability { available: boolean, reason: 'invalid' | 'taken' | null, message: string }

const checking = ref(false)
const availability = ref<Availability | null>(null)
let debounce: ReturnType<typeof setTimeout> | undefined

watch(username, (value) => {
  availability.value = null
  clearTimeout(debounce)
  if (value.length < 2) return

  checking.value = true
  debounce = setTimeout(async () => {
    try {
      availability.value = await $fetch<Availability>('/api/username-available', {
        query: { username: value }
      })
    } catch {
      availability.value = null
    } finally {
      checking.value = false
    }
  }, 350)
})

onBeforeUnmount(() => clearTimeout(debounce))

const linkMessage = computed(() => {
  if (!username.value || username.value.length < 2) return null
  if (checking.value) return { tone: 'muted', text: 'Checking…' }
  if (!availability.value) return null

  return {
    tone: availability.value.available ? 'ok' : 'bad',
    text: availability.value.message
  }
})

const linkState = computed<'ok' | 'bad' | 'busy' | null>(() => {
  if (!username.value || username.value.length < 2) return null
  if (checking.value) return 'busy'
  if (!availability.value) return null
  return availability.value.available ? 'ok' : 'bad'
})

const canSubmit = computed(() => !pending.value && availability.value?.available !== false)

async function submit() {
  if (pending.value) return

  if (availability.value && !availability.value.available) {
    error.value = 'Please pick a different link.'
    return
  }

  pending.value = true
  error.value = ''

  const address = email.value.trim()

  const { error: failure } = await signUp.email({
    name: name.value.trim(),
    username: username.value,
    email: address,
    password: password.value,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
  })

  pending.value = false

  if (failure) {
    error.value = failure.message?.toLowerCase().includes('exist')
      ? 'An account with that email already exists.'
      : failure.message || 'Something went wrong. Please try again.'
    return
  }

  await navigateTo(`/verify-email?email=${encodeURIComponent(address)}`)
}
</script>

<template>
  <div>
    <h1 class="font-editorial text-[2.75rem] leading-[1.02] tracking-[-0.02em] text-highlighted">
      Create your link.
    </h1>
    <p class="mt-3 text-[15px] leading-relaxed text-muted">
      Free, and about two minutes. You can change any of this later.
    </p>

    <template v-if="methods?.google">
      <div class="mt-8">
        <GoogleButton label="Sign up with Google" />
      </div>

      <div class="my-7 flex items-center gap-4">
        <span class="h-px flex-1 bg-border" />
        <span class="text-[12px] text-dimmed">or with email</span>
        <span class="h-px flex-1 bg-border" />
      </div>
    </template>

    <form
      :class="methods?.google ? 'space-y-5' : 'mt-8 space-y-5'"
      novalidate
      @submit.prevent="submit"
    >
      <UFormField
        label="Your name"
        name="name"
      >
        <UInput
          v-model="name"
          size="xl"
          autocomplete="name"
          placeholder="Ada Lovelace"
          required
          class="w-full"
        />
      </UFormField>

      <UFormField
        label="Your booking link"
        name="username"
      >
        <UsernameField
          v-model="username"
          :state="linkState"
          required
          @input="touched = true"
        />
        <p
          v-if="linkMessage"
          class="mt-1.5 text-[12px]"
          :class="{
            'text-green-600 dark:text-green-500': linkMessage.tone === 'ok',
            'text-red-600 dark:text-red-500': linkMessage.tone === 'bad',
            'text-dimmed': linkMessage.tone === 'muted'
          }"
        >
          {{ linkMessage.text }}
        </p>
      </UFormField>

      <UFormField
        label="Email"
        name="email"
      >
        <UInput
          v-model="email"
          type="email"
          size="xl"
          autocomplete="email"
          placeholder="ada@example.com"
          required
          class="w-full"
        />
      </UFormField>

      <UFormField
        label="Password"
        name="password"
      >
        <UInput
          v-model="password"
          type="password"
          size="xl"
          autocomplete="new-password"
          placeholder="At least 10 characters"
          required
          class="w-full"
        />

        <div class="mt-2 flex items-center gap-3">
          <div
            class="flex flex-1 gap-1.5"
            aria-hidden="true"
          >
            <span
              v-for="step in 3"
              :key="step"
              class="h-1 flex-1 rounded-full transition-colors"
              :class="strength.score >= step ? strength.barClass : 'bg-accented'"
            />
          </div>
          <span
            v-if="strength.label"
            class="text-[12px] font-medium"
            :class="strength.textClass"
          >{{ strength.label }}</span>
        </div>
        <p class="mt-1.5 text-[12px] text-dimmed">
          Length beats symbols — a few ordinary words is stronger than
          <span class="whitespace-nowrap">P@ssw0rd!</span>
        </p>
      </UFormField>

      <p
        v-if="error"
        class="rounded-lg border border-error/30 bg-error/10 px-3.5 py-2.5 text-[13px] text-error"
        role="alert"
      >
        {{ error }}
      </p>

      <UButton
        type="submit"
        size="xl"
        block
        :loading="pending"
        :disabled="!canSubmit"
        class="rounded-full font-medium"
      >
        Create my link
      </UButton>

      <p class="text-center text-[12px] leading-relaxed text-dimmed">
        We'll email you a link to confirm your address.
      </p>
    </form>

    <p class="mt-8 border-t border-default pt-6 text-[14px] text-muted">
      Already have one?
      <NuxtLink
        to="/login"
        class="font-medium text-highlighted underline underline-offset-4"
      >Sign in</NuxtLink>
    </p>
  </div>
</template>
